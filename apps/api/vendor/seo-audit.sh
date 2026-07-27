#!/usr/bin/env bash
# audit.sh — live SEO + AEO auditor.
# Usage: ./audit.sh [flags] <url>
#
# Flags:
#   --json                 Structured JSON output instead of the human report.
#   --insights             Also run real Google Lighthouse Performance/Accessibility/
#                          Best-Practices scores via the PageSpeed API. Slower (~15-45s
#                          extra) — opt-in so the default audit stays fast. Runs
#                          automatically if PAGESPEED_API_KEY is set, with or without
#                          this flag.
#   --crawl[=N]            Also audit up to N pages (default 5), discovered from
#                          sitemap.xml or same-host links on the homepage, and roll
#                          up site-wide findings.
#   --history-dir=DIR      Save a timestamped snapshot to DIR and diff against the
#                          most recent prior snapshot there (resolved/new findings,
#                          trend over time). Creates DIR if it doesn't exist.
#   --gbp[=QUERY]          Look up the business's Google Business Profile (via the
#                          Google Places API) and score its public visibility —
#                          website link, phone, hours, category, rating, review
#                          count/recency, photo count. Without QUERY, auto-builds
#                          the search from the page's LocalBusiness schema
#                          (name + address) if present. Requires
#                          GOOGLE_PLACES_API_KEY to be set — runs automatically if
#                          it is, with or without this flag.
#
# Checks, live, on the real site: AI crawler access (robots.txt), llms.txt / llms-full.txt
# status, on-page SEO, JSON-LD schema markup, sitemap.xml, local SEO signals, HTTPS
# enforcement, performance, and (optionally) real Lighthouse scores + this tool's own
# Agentic Browsing heuristic — then prints a prioritized fix list.

set -uo pipefail

JSON_MODE=0
INSIGHTS_MODE=0
CRAWL_N=0
HISTORY_DIR=""
GBP_MODE=0
GBP_QUERY=""
RAW_INPUT=""
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    --insights) INSIGHTS_MODE=1 ;;
    --crawl) CRAWL_N=5 ;;
    --crawl=*) CRAWL_N="${arg#--crawl=}" ;;
    --history-dir=*) HISTORY_DIR="${arg#--history-dir=}" ;;
    --gbp) GBP_MODE=1 ;;
    --gbp=*) GBP_MODE=1; GBP_QUERY="${arg#--gbp=}" ;;
    -*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) RAW_INPUT="$arg" ;;
  esac
done

if [[ -z "$RAW_INPUT" ]]; then
  echo "Usage: $0 [--json] [--insights] [--crawl[=N]] [--history-dir=DIR] [--gbp[=QUERY]] <url>" >&2
  echo "Example: $0 example.com" >&2
  echo "         $0 --json --crawl=8 example.com" >&2
  echo "         $0 --gbp=\"Example Business, Austin TX\" example.com" >&2
  exit 1
fi

if ! [[ "$CRAWL_N" =~ ^[0-9]+$ ]]; then
  echo "Error: --crawl needs a positive integer (got '$CRAWL_N')." >&2
  exit 1
fi

for bin in curl python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Error: '$bin' is required but not found on this system." >&2
    exit 1
  fi
done

UA="Mozilla/5.0 (compatible; SEO-AEO-Audit/1.0; +https://github.com/anthropics/claude-code)"

# Normalize the input into scheme / host / path using Python's urllib (handles
# missing schemes, trailing slashes, ports, etc. far more reliably than bash regex).
mapfile -t PARTS < <(python3 -c "
import sys
from urllib.parse import urlparse
u = sys.argv[1].strip()
if '://' not in u:
    u = 'https://' + u
p = urlparse(u)
scheme = p.scheme if p.scheme in ('http', 'https') else 'https'
host = p.netloc
path = p.path or '/'
print(scheme)
print(host)
print(path)
" "$RAW_INPUT")

SCHEME="${PARTS[0]:-https}"
HOST="${PARTS[1]:-}"
PATHV="${PARTS[2]:-/}"

if [[ -z "$HOST" ]]; then
  echo "Error: couldn't parse a hostname out of '$RAW_INPUT'." >&2
  exit 1
fi

TARGET_URL="${SCHEME}://${HOST}${PATHV}"
TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/seo-aeo-audit.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

START_TS=$(date +%s)

# --- Fire off all independent network checks in parallel so worst-case total
# --- time stays bounded by the slowest single request, not the sum of all of them.

# 1. robots.txt
(
  curl -sS -L --max-time 8 -A "$UA" -o "$TMPDIR/robots.txt" \
    -w '%{http_code}' "https://${HOST}/robots.txt" > "$TMPDIR/robots_status.txt" 2>"$TMPDIR/robots_err.txt"
) &
PID_ROBOTS=$!

# 2. llms.txt (status only — we care whether it exists, and read it if small)
(
  curl -sS -L --max-time 8 -A "$UA" -o "$TMPDIR/llms.txt" \
    -w '%{http_code}' "https://${HOST}/llms.txt" > "$TMPDIR/llms_status.txt" 2>"$TMPDIR/llms_err.txt"
) &
PID_LLMS=$!

# 3. llms-full.txt (status only)
(
  curl -sS -L --max-time 8 -A "$UA" -o /dev/null \
    -w '%{http_code}' "https://${HOST}/llms-full.txt" > "$TMPDIR/llmsfull_status.txt" 2>"$TMPDIR/llmsfull_err.txt"
) &
PID_LLMSFULL=$!

# 4. HTTPS enforcement check — request the plain-http version and see where it lands.
(
  curl -sS -L --max-time 8 -A "$UA" -o /dev/null \
    -w '%{http_code}|%{url_effective}' "http://${HOST}/" > "$TMPDIR/https_check.txt" 2>"$TMPDIR/https_err.txt"
) &
PID_HTTPS=$!

# 5. The actual page fetch (this is the one everything else waits on for content).
(
  curl -sS -L --max-time 15 -A "$UA" -D "$TMPDIR/headers.txt" -o "$TMPDIR/page.html" \
    -w '%{http_code}|%{time_starttransfer}|%{time_total}|%{size_download}|%{url_effective}' \
    "$TARGET_URL" > "$TMPDIR/curlstats.txt" 2>"$TMPDIR/page_err.txt"
) &
PID_PAGE=$!

# 6. sitemap.xml
(
  curl -sS -L --max-time 8 -A "$UA" -o "$TMPDIR/sitemap.xml" \
    -w '%{http_code}' "https://${HOST}/sitemap.xml" > "$TMPDIR/sitemap_status.txt" 2>"$TMPDIR/sitemap_err.txt"
) &
PID_SITEMAP=$!

wait "$PID_ROBOTS" "$PID_LLMS" "$PID_LLMSFULL" "$PID_HTTPS" "$PID_PAGE" "$PID_SITEMAP" 2>/dev/null

ELAPSED=$(( $(date +%s) - START_TS ))

# --- Hand everything off to Python for parsing, scoring, and the formatted report.
# Passed as argv (not interpolated into the heredoc) so nothing in the URL or fetched
# content can be interpreted as shell syntax.
python3 - "$TARGET_URL" "$SCHEME" "$HOST" "$PATHV" "$TMPDIR" "$ELAPSED" "$JSON_MODE" \
  "$CRAWL_N" "$HISTORY_DIR" "$INSIGHTS_MODE" "$UA" "$GBP_MODE" "$GBP_QUERY" <<'PYEOF'
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

(TARGET_URL, SCHEME, HOST, PATHV, TMPDIR, ELAPSED, JSON_MODE,
 CRAWL_N, HISTORY_DIR, INSIGHTS_MODE, UA, GBP_MODE, GBP_QUERY) = sys.argv[1:14]
ELAPSED = int(ELAPSED)
JSON_MODE = JSON_MODE == '1'
CRAWL_N = int(CRAWL_N)
INSIGHTS_MODE = INSIGHTS_MODE == '1'
GBP_MODE = GBP_MODE == '1'

def read_text(name, default=''):
    p = os.path.join(TMPDIR, name)
    try:
        with open(p, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except FileNotFoundError:
        return default

def read_first_field(name, sep='|', default=None):
    raw = read_text(name, '').strip()
    if not raw:
        return default
    return raw.split(sep)

# ---------------------------------------------------------------------------
# robots.txt — parse and check AI-crawler access
# ---------------------------------------------------------------------------

AI_BOTS = [
    ("GPTBot", "OpenAI — training crawler"),
    ("ChatGPT-User", "OpenAI — live browsing in ChatGPT"),
    ("OAI-SearchBot", "OpenAI — ChatGPT search"),
    ("ClaudeBot", "Anthropic — training crawler"),
    ("Claude-User", "Anthropic — live browsing in Claude"),
    ("PerplexityBot", "Perplexity — search crawler"),
    ("Perplexity-User", "Perplexity — live browsing"),
    ("Google-Extended", "Google — Gemini / AI Overviews training"),
    ("CCBot", "Common Crawl — feeds many LLM training sets"),
    ("Applebot-Extended", "Apple Intelligence training"),
    ("Bytespider", "ByteDance / TikTok AI crawler"),
    ("Amazonbot", "Amazon AI crawler"),
]

def parse_robots(text):
    groups = {}
    current_agents = []
    last_was_rule = True
    for raw_line in text.splitlines():
        line = raw_line.split('#', 1)[0].strip()
        if not line or ':' not in line:
            continue
        key, _, val = line.partition(':')
        key = key.strip().lower()
        val = val.strip()
        if key == 'user-agent':
            if last_was_rule:
                current_agents = []
            current_agents.append(val.lower())
            groups.setdefault(val.lower(), [])
            last_was_rule = False
        elif key in ('allow', 'disallow'):
            for a in current_agents:
                groups.setdefault(a, []).append((key, val))
            last_was_rule = True
    return groups

def bot_root_status(groups, bot):
    key = bot.lower()
    matched_specific = key in groups
    rules = groups.get(key) if matched_specific else groups.get('*', [])
    if not rules:
        return 'ALLOWED', None
    allow_root = any(t == 'allow' and p == '/' for t, p in rules)
    disallow_root = any(t == 'disallow' and p == '/' for t, p in rules)
    if disallow_root and not allow_root:
        via = f"User-agent: {bot}" if matched_specific else "User-agent: *"
        return 'BLOCKED', f"Disallow: / under {via}"
    return 'ALLOWED', None

robots_status_parts = read_first_field('robots_status.txt', default=['000'])
robots_http_code = robots_status_parts[0] if robots_status_parts else '000'
robots_txt = read_text('robots.txt')
robots_exists = robots_http_code == '200'
robots_groups = parse_robots(robots_txt) if robots_exists else {}

bot_results = []
for bot, desc in AI_BOTS:
    status, reason = bot_root_status(robots_groups, bot) if robots_exists else ('ALLOWED', None)
    bot_results.append((bot, desc, status, reason))

blocked_bots = [b for b in bot_results if b[2] == 'BLOCKED']

# ---------------------------------------------------------------------------
# llms.txt / llms-full.txt
# ---------------------------------------------------------------------------

llms_status = (read_first_field('llms_status.txt', default=['000']) or ['000'])[0]
llmsfull_status = (read_first_field('llmsfull_status.txt', default=['000']) or ['000'])[0]
llms_exists = llms_status == '200'
llmsfull_exists = llmsfull_status == '200'

# ---------------------------------------------------------------------------
# sitemap.xml
# ---------------------------------------------------------------------------

sitemap_status = (read_first_field('sitemap_status.txt', default=['000']) or ['000'])[0]
sitemap_exists = sitemap_status == '200'
sitemap_raw = read_text('sitemap.xml') if sitemap_exists else ''

def parse_sitemap(xml_text):
    """Returns (urls, is_index, valid)."""
    if not xml_text.strip():
        return [], False, False
    try:
        root = ET.fromstring(xml_text)
        is_index = root.tag.split('}')[-1] == 'sitemapindex'
        urls = []
        for elem in root.iter():
            if elem.tag.split('}')[-1] == 'loc' and elem.text:
                urls.append(elem.text.strip())
        return urls, is_index, True
    except ET.ParseError:
        urls = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml_text, re.IGNORECASE)
        return urls, False, bool(urls)

sitemap_urls, sitemap_is_index, sitemap_valid = parse_sitemap(sitemap_raw)
sitemap_in_robots = bool(re.search(r'(?im)^sitemap:\s*\S+', robots_txt)) if robots_exists else False

# ---------------------------------------------------------------------------
# HTTPS enforcement
# ---------------------------------------------------------------------------

https_check = read_first_field('https_check.txt', default=['000', ''])
http_final_code = https_check[0] if len(https_check) > 0 else '000'
http_final_url = https_check[1] if len(https_check) > 1 else ''
https_enforced = http_final_url.startswith('https://')

# ---------------------------------------------------------------------------
# Main page fetch stats + HTML parsing
# ---------------------------------------------------------------------------

page_stats = read_first_field('curlstats.txt', default=['000', '0', '0', '0', ''])
page_http_code = page_stats[0] if len(page_stats) > 0 else '000'
try:
    ttfb_ms = round(float(page_stats[1]) * 1000)
except (ValueError, IndexError):
    ttfb_ms = None
try:
    total_ms = round(float(page_stats[2]) * 1000)
except (ValueError, IndexError):
    total_ms = None
try:
    page_bytes = int(page_stats[3])
except (ValueError, IndexError):
    page_bytes = None

page_fetched_ok = page_http_code.startswith('2')
html_text = read_text('page.html') if page_fetched_ok else ''

EXCLUDED_INPUT_TYPES = {'hidden', 'submit', 'button', 'image', 'reset'}


class PageParser(HTMLParser):
    """Parses one page for on-page SEO, schema, and agentic-browsing signals."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None
        self.meta_description = None
        self.h1s = []
        self.canonical = None
        self.viewport = None
        self.lang = None
        self.jsonld_blocks = []
        self.interactive_elements = []   # [{'has_text':, 'has_aria_label':}]
        self.form_inputs = []            # [{'id':, 'has_aria_label':, 'wrapped_in_label':}]
        self.label_fors = set()
        self._in_title = False
        self._in_h1 = False
        self._cur_h1 = []
        self._in_ld = False
        self._cur_ld = []
        self._interactive_stack = []     # stack of dicts being accumulated
        self._label_depth = 0

    def handle_starttag(self, tag, attrs_list):
        attrs = dict(attrs_list)
        t = tag.lower()
        if t == 'html' and self.lang is None and attrs.get('lang'):
            self.lang = attrs.get('lang')
        elif t == 'title':
            self._in_title = True
            self.title = self.title or ''
        elif t == 'meta':
            name = (attrs.get('name') or '').lower()
            if name == 'description' and self.meta_description is None:
                self.meta_description = attrs.get('content', '')
            if name == 'viewport' and self.viewport is None:
                self.viewport = attrs.get('content', '')
        elif t == 'link':
            rel = (attrs.get('rel') or '').lower()
            if rel == 'canonical' and self.canonical is None:
                self.canonical = attrs.get('href')
        elif t == 'h1':
            self._in_h1 = True
            self._cur_h1 = []
        elif t == 'script' and (attrs.get('type') or '').lower() == 'application/ld+json':
            self._in_ld = True
            self._cur_ld = []
        elif t in ('a', 'button'):
            has_aria = bool(attrs.get('aria-label') or attrs.get('aria-labelledby'))
            entry = {'has_text': False, 'has_aria_label': has_aria}
            self._interactive_stack.append(entry)
            self.interactive_elements.append(entry)
        elif t == 'label':
            self._label_depth += 1
            if attrs.get('for'):
                self.label_fors.add(attrs['for'])
        elif t in ('input', 'textarea', 'select'):
            input_type = (attrs.get('type') or 'text').lower() if t == 'input' else t
            if input_type not in EXCLUDED_INPUT_TYPES:
                self.form_inputs.append({
                    'id': attrs.get('id'),
                    'has_aria_label': bool(attrs.get('aria-label') or attrs.get('aria-labelledby')),
                    'wrapped_in_label': self._label_depth > 0,
                })

    def handle_endtag(self, tag):
        t = tag.lower()
        if t == 'title':
            self._in_title = False
        elif t == 'h1':
            self._in_h1 = False
            text = ''.join(self._cur_h1).strip()
            if text:
                self.h1s.append(text)
        elif t == 'script' and self._in_ld:
            self._in_ld = False
            self.jsonld_blocks.append(''.join(self._cur_ld))
        elif t in ('a', 'button') and self._interactive_stack:
            self._interactive_stack.pop()
        elif t == 'label' and self._label_depth > 0:
            self._label_depth -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_h1:
            self._cur_h1.append(data)
        if self._in_ld:
            self._cur_ld.append(data)
        if data.strip():
            for entry in self._interactive_stack:
                entry['has_text'] = True


page = PageParser()
if html_text:
    try:
        page.feed(html_text)
    except Exception:
        pass

title = (page.title or '').strip()
meta_desc = (page.meta_description or '').strip()

def extract_schema_types(blocks):
    types = set()

    def walk(node):
        if isinstance(node, dict):
            t = node.get('@type')
            if isinstance(t, str):
                types.add(t)
            elif isinstance(t, list):
                for x in t:
                    if isinstance(x, str):
                        types.add(x)
            for v in node.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for raw in blocks:
        raw = raw.strip()
        if not raw:
            continue
        try:
            walk(json.loads(raw))
        except Exception:
            continue
    return types

schema_types = extract_schema_types(page.jsonld_blocks)

HIGH_VALUE_TYPES = {'Organization', 'WebSite', 'FAQPage', 'Article', 'BlogPosting',
                     'Product', 'LocalBusiness', 'BreadcrumbList'}
# A practical (not exhaustive) subset of schema.org subtypes that satisfy the
# parent type above — e.g. a site using the more specific "BeautySalon" has
# already covered "LocalBusiness" and shouldn't be told it's missing.
SUBTYPE_SATISFIES = {
    'LocalBusiness': {
        'BeautySalon', 'Dentist', 'Restaurant', 'Store', 'MedicalBusiness',
        'ProfessionalService', 'HealthAndBeautyBusiness', 'HairSalon', 'DaySpa',
        'AutoRepair', 'HomeAndConstructionBusiness', 'LegalService', 'RealEstateAgent',
        'FoodEstablishment', 'LodgingBusiness', 'Physician', 'Attorney',
    },
    'Article': {'BlogPosting', 'NewsArticle', 'TechArticle', 'Report'},
    'Organization': {'Corporation', 'NGO', 'EducationalOrganization', 'LocalBusiness',
                      'GovernmentOrganization', 'SportsOrganization'},
}
satisfied = set()
for parent, subtypes in SUBTYPE_SATISFIES.items():
    if subtypes & schema_types:
        satisfied.add(parent)
missing_high_value = HIGH_VALUE_TYPES - schema_types - satisfied

def word_count(html):
    if not html:
        return 0
    html = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', html)
    text = re.sub(r'(?s)<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    return len(text.split(' ')) if text else 0

wc = word_count(html_text)

# ---------------------------------------------------------------------------
# Local SEO depth
# ---------------------------------------------------------------------------

LOCAL_BUSINESS_TYPES = {'LocalBusiness'} | SUBTYPE_SATISFIES['LocalBusiness']

def find_first_matching_schema(blocks, wanted_types):
    def walk(node):
        if isinstance(node, dict):
            t = node.get('@type')
            types = [t] if isinstance(t, str) else (t if isinstance(t, list) else [])
            if any(x in wanted_types for x in types):
                return node
            for v in node.values():
                if isinstance(v, (dict, list)):
                    found = walk(v)
                    if found:
                        return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        return None

    for raw in blocks:
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        found = walk(data)
        if found:
            return found
    return None

def find_same_as(blocks):
    result = []

    def walk(node):
        if isinstance(node, dict):
            sa = node.get('sameAs')
            if isinstance(sa, list):
                result.extend(x for x in sa if isinstance(x, str))
            elif isinstance(sa, str):
                result.append(sa)
            for v in node.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for raw in blocks:
        raw = raw.strip()
        if not raw:
            continue
        try:
            walk(json.loads(raw))
        except Exception:
            continue
    return result

local_biz = find_first_matching_schema(page.jsonld_blocks, LOCAL_BUSINESS_TYPES) if page_fetched_ok else None
nap_checks = {}
if local_biz:
    nap_checks = {
        'name': bool(local_biz.get('name')),
        'address': bool(local_biz.get('address')),
        'telephone': bool(local_biz.get('telephone')),
        'hours': bool(local_biz.get('openingHoursSpecification') or local_biz.get('openingHours')),
        'geo coordinates': bool(local_biz.get('geo')),
        'priceRange': bool(local_biz.get('priceRange')),
    }
nap_complete_count = sum(1 for v in nap_checks.values() if v)
nap_total_count = len(nap_checks)

gbp_link_found = bool(re.search(
    r'(?i)(maps\.google\.[a-z.]+|g\.page/|goo\.gl/maps|business\.google\.com)', html_text
)) if html_text else False
same_as_links = find_same_as(page.jsonld_blocks)

# ---------------------------------------------------------------------------
# Google Business Profile lookup (--gbp) — real public data via the Google
# Places API (legacy Find Place + Place Details endpoints). Requires
# GOOGLE_PLACES_API_KEY. Scored with the same weighted-checks approach as
# Agentic Browsing below, but this one reflects real API data, not a heuristic
# guess about the page's HTML.
# ---------------------------------------------------------------------------

def build_gbp_query(override, biz):
    if override.strip():
        return override.strip()
    if not biz:
        return None
    name = biz.get('name')
    if not name:
        return None
    addr = biz.get('address')
    locality = None
    region = None
    if isinstance(addr, dict):
        locality = addr.get('addressLocality')
        region = addr.get('addressRegion')
    elif isinstance(addr, str):
        return f"{name}, {addr}"
    parts = [name] + [p for p in (locality, region) if p]
    return ', '.join(parts) if len(parts) > 1 else name

def try_gbp_lookup(query, ua):
    api_key = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
    if not api_key or not query:
        return None
    try:
        find_qs = urllib.parse.urlencode({
            'input': query, 'inputtype': 'textquery',
            'fields': 'place_id,name', 'key': api_key,
        })
        req = urllib.request.Request(
            f'https://maps.googleapis.com/maps/api/place/findplacefromtext/json?{find_qs}',
            headers={'User-Agent': ua})
        with urllib.request.urlopen(req, timeout=10) as resp:
            find_data = json.loads(resp.read().decode('utf-8', 'replace'))
        candidates = find_data.get('candidates') or []
        if find_data.get('status') != 'OK' or not candidates:
            return {'found': False, 'query': query, 'api_status': find_data.get('status')}
        place_id = candidates[0]['place_id']

        fields = ('name,formatted_address,formatted_phone_number,website,url,'
                  'rating,user_ratings_total,opening_hours,business_status,'
                  'price_level,photos,reviews,types')
        det_qs = urllib.parse.urlencode({'place_id': place_id, 'fields': fields, 'key': api_key})
        req = urllib.request.Request(
            f'https://maps.googleapis.com/maps/api/place/details/json?{det_qs}',
            headers={'User-Agent': ua})
        with urllib.request.urlopen(req, timeout=10) as resp:
            det_data = json.loads(resp.read().decode('utf-8', 'replace'))
        if det_data.get('status') != 'OK':
            return {'found': False, 'query': query, 'api_status': det_data.get('status')}

        r = det_data['result']
        reviews = r.get('reviews') or []
        most_recent_days_ago = None
        if reviews:
            newest_ts = max(rev.get('time', 0) for rev in reviews)
            most_recent_days_ago = round((time.time() - newest_ts) / 86400)
        photos = r.get('photos') or []
        return {
            'found': True,
            'query': query,
            'name': r.get('name'),
            'formatted_address': r.get('formatted_address'),
            'phone': r.get('formatted_phone_number'),
            'website': r.get('website'),
            'maps_url': r.get('url'),
            'business_status': r.get('business_status', 'OPERATIONAL'),
            'rating': r.get('rating'),
            'user_ratings_total': r.get('user_ratings_total', 0),
            'categories': r.get('types') or [],
            'hours_present': bool(r.get('opening_hours', {}).get('weekday_text')),
            'photo_count_sample': len(photos),
            'photo_count_is_capped': len(photos) >= 10,
            'most_recent_review_days_ago': most_recent_days_ago,
        }
    except Exception as e:
        return {'found': None, 'query': query, 'error': str(e)}

GENERIC_ONLY_TYPES = {'point_of_interest', 'establishment'}

def compute_gbp_score(gbp):
    checks = []
    status_ok = gbp.get('business_status', 'OPERATIONAL') == 'OPERATIONAL'
    checks.append(('Listing is OPERATIONAL (not marked closed)', status_ok, 20))

    website = (gbp.get('website') or '').lower()
    website_matches = bool(website) and HOST.lower().replace('www.', '') in website.replace('www.', '')
    checks.append((f"Website field links to the audited site", website_matches, 15))

    checks.append(('Phone number listed', bool(gbp.get('phone')), 10))
    checks.append(('Hours listed', bool(gbp.get('hours_present')), 10))

    cats = set(gbp.get('categories') or [])
    specific_category = bool(cats - GENERIC_ONLY_TYPES)
    checks.append(('Specific business category set (not just generic)', specific_category, 10))

    rating = gbp.get('rating')
    review_count = gbp.get('user_ratings_total') or 0
    rating_ok = rating is not None and rating >= 4.0
    checks.append((f"Rating is 4.0+ ({rating if rating is not None else 'no rating'})", rating_ok, 15))
    checks.append((f"10+ reviews ({review_count})", review_count >= 10, 10))

    days_ago = gbp.get('most_recent_review_days_ago')
    recent_ok = days_ago is not None and days_ago <= 180
    checks.append(('Recent review activity (sample within ~180 days)', recent_ok, 5))

    photo_count = gbp.get('photo_count_sample') or 0
    checks.append((f"5+ photos visible ({photo_count}{'+' if gbp.get('photo_count_is_capped') else ''})",
                    photo_count >= 5, 5))

    total_weight = sum(w for _, _, w in checks)
    earned = sum(w for _, passed, w in checks if passed)
    score = round(earned / total_weight * 100) if total_weight else 0
    return score, checks

attempt_gbp = GBP_MODE or bool(os.environ.get('GOOGLE_PLACES_API_KEY', '').strip())
gbp_query = build_gbp_query(GBP_QUERY, local_biz) if attempt_gbp else None
gbp_result = try_gbp_lookup(gbp_query, UA) if attempt_gbp else None
gbp_score, gbp_checks = (None, [])
if gbp_result and gbp_result.get('found'):
    gbp_score, gbp_checks = compute_gbp_score(gbp_result)

# ---------------------------------------------------------------------------
# Agentic Browsing score — our own heuristic, not a third-party standard.
# Measures how usable the page is for an AI agent operating it programmatically
# (not how it looks/performs to a human) using only static-HTML signals.
# ---------------------------------------------------------------------------

def compute_agentic_score(html, parsed_page, schema_found, words):
    checks = []

    landmarks = bool(re.search(r'(?is)<(main|nav|header|footer)\b', html)) or \
        bool(re.search(r'(?i)role\s*=\s*["\'](main|navigation|banner|contentinfo)["\']', html))
    checks.append(('Semantic landmarks present (main/nav/header or ARIA roles)', landmarks, 15))

    total_interactive = len(parsed_page.interactive_elements)
    if total_interactive == 0:
        checks.append(('Buttons/links have accessible text', True, 20))
    else:
        passing = sum(1 for e in parsed_page.interactive_elements if e['has_text'] or e['has_aria_label'])
        ratio = passing / total_interactive
        checks.append((f'Buttons/links have accessible text ({passing}/{total_interactive})', ratio >= 0.9, 20))

    total_inputs = len(parsed_page.form_inputs)
    if total_inputs == 0:
        checks.append(('Form inputs are labeled', True, 20))
    else:
        labeled = sum(
            1 for i in parsed_page.form_inputs
            if i['wrapped_in_label'] or i['has_aria_label'] or (i['id'] and i['id'] in parsed_page.label_fors)
        )
        ratio = labeled / total_inputs
        checks.append((f'Form inputs are labeled ({labeled}/{total_inputs})', ratio >= 0.9, 20))

    botwall = bool(re.search(r'(?i)(recaptcha|hcaptcha|cf-chl-|turnstile|g-recaptcha|challenge-platform)', html))
    checks.append(('No CAPTCHA/bot-wall blocking access', not botwall, 15))

    checks.append(('Structured data (schema markup) present', bool(schema_found), 15))
    checks.append(('Substantive content in static HTML (not a JS-only shell)', words >= 300, 15))

    total_weight = sum(w for _, _, w in checks)
    earned = sum(w for _, passed, w in checks if passed)
    score = round(earned / total_weight * 100) if total_weight else 0
    return score, checks

agentic_score, agentic_checks = compute_agentic_score(html_text, page, schema_types, wc) if page_fetched_ok else (None, [])

# ---------------------------------------------------------------------------
# Performance: real Core Web Vitals + (opt-in) real Lighthouse category scores.
# Never fabricate real data — an honest curl-timing proxy is the fallback.
# ---------------------------------------------------------------------------

def try_pagespeed(url, categories):
    api_key = os.environ.get('PAGESPEED_API_KEY', '').strip()
    try:
        params = [('url', url), ('strategy', 'mobile')]
        for c in categories:
            params.append(('category', c))
        if api_key:
            params.append(('key', api_key))
        qs = urllib.parse.urlencode(params)
        req = urllib.request.Request(
            f'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?{qs}',
            headers={'User-Agent': 'seo-aeo-audit/1.0'},
        )
        timeout = 45 if len(categories) > 1 else 10
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))

        result = {'cwv': None, 'scores': {}}
        metrics = data.get('loadingExperience', {}).get('metrics', {})
        if metrics:
            def cat(key):
                m = metrics.get(key)
                return m.get('category') if m else None
            result['cwv'] = {
                'lcp': cat('LARGEST_CONTENTFUL_PAINT_MS'),
                'cls': cat('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
                'inp': cat('INTERACTION_TO_NEXT_PAINT'),
            }
        lh_categories = data.get('lighthouseResult', {}).get('categories', {})
        for key, out_key in [('performance', 'performance'), ('accessibility', 'accessibility'),
                              ('best-practices', 'best_practices')]:
            c = lh_categories.get(key)
            if c and c.get('score') is not None:
                result['scores'][out_key] = round(c['score'] * 100)
        return result
    except Exception:
        return None

attempt_insights = INSIGHTS_MODE or bool(os.environ.get('PAGESPEED_API_KEY', '').strip())
pagespeed_categories = ['performance', 'accessibility', 'best-practices'] if attempt_insights else ['performance']
pagespeed_result = try_pagespeed(TARGET_URL, pagespeed_categories) if page_fetched_ok else None
cwv = pagespeed_result['cwv'] if pagespeed_result else None
lighthouse_scores = pagespeed_result['scores'] if pagespeed_result else {}

def score_tier(score):
    if score is None:
        return None
    if score >= 90:
        return 'Good'
    if score >= 50:
        return 'Needs Improvement'
    return 'Poor'

# ---------------------------------------------------------------------------
# Multi-page crawl (--crawl)
# ---------------------------------------------------------------------------

def discover_page_urls(base_host, sitemap_page_urls, homepage_html, homepage_url, limit):
    seen = set()
    candidates = []
    for u in sitemap_page_urls:
        try:
            p = urllib.parse.urlparse(u)
        except Exception:
            continue
        if p.netloc == base_host and u not in seen:
            seen.add(u)
            candidates.append(u)
    if len(candidates) < limit and homepage_html:
        for m in re.finditer(r'(?i)<a\s[^>]*href=["\']([^"\']+)["\']', homepage_html):
            full = urllib.parse.urljoin(homepage_url, m.group(1)).split('#')[0]
            p = urllib.parse.urlparse(full)
            if p.scheme in ('http', 'https') and p.netloc == base_host and full not in seen:
                seen.add(full)
                candidates.append(full)
            if len(candidates) >= limit * 3:
                break
    ordered = [homepage_url] + [u for u in candidates if u != homepage_url]
    out, seen2 = [], set()
    for u in ordered:
        if u not in seen2:
            seen2.add(u)
            out.append(u)
    return out[:limit]

def fetch_page_lite(url, ua, timeout=10):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': ua})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read().decode('utf-8', 'replace')
    except Exception:
        return None, ''

def analyze_page_lite(url, html):
    p = PageParser()
    if html:
        try:
            p.feed(html)
        except Exception:
            pass
    t = (p.title or '').strip()
    md = (p.meta_description or '').strip()
    types = extract_schema_types(p.jsonld_blocks)
    wcount = word_count(html)
    issues = []
    if not t:
        issues.append('missing title')
    elif len(t) > 60:
        issues.append(f'title too long ({len(t)} chars)')
    if not md:
        issues.append('missing meta description')
    if len(p.h1s) == 0:
        issues.append('no H1')
    elif len(p.h1s) > 1:
        issues.append(f'{len(p.h1s)} H1 tags')
    if not types:
        issues.append('no schema markup')
    if wcount < 300:
        issues.append(f'thin content ({wcount} words)')
    return {
        'url': url, 'title': t or None, 'title_length': len(t),
        'meta_description_present': bool(md), 'h1_count': len(p.h1s),
        'schema_found': sorted(types), 'word_count': wcount, 'issues': issues,
    }

crawl_pages = None
if CRAWL_N > 0 and page_fetched_ok:
    sitemap_page_urls = sitemap_urls if (sitemap_valid and not sitemap_is_index) else []
    page_urls = discover_page_urls(HOST, sitemap_page_urls, html_text, TARGET_URL, CRAWL_N)
    results = {TARGET_URL: analyze_page_lite(TARGET_URL, html_text)}
    others = [u for u in page_urls if u != TARGET_URL]
    if others:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(others))) as ex:
            futures = {u: ex.submit(fetch_page_lite, u, UA) for u in others}
            for u, fut in futures.items():
                code, body = fut.result()
                if code and 200 <= code < 300:
                    results[u] = analyze_page_lite(u, body)
                else:
                    results[u] = {'url': u, 'error': f"fetch failed (HTTP {code or 'error'})"}
    crawl_pages = [results[u] for u in page_urls if u in results]

# ---------------------------------------------------------------------------
# Build the prioritized findings list
# ---------------------------------------------------------------------------

SEV_ORDER = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
findings = []

def add(sev, msg, fix):
    findings.append((sev, msg, fix))

if not page_fetched_ok:
    add('CRITICAL', f"The page itself didn't load cleanly (HTTP {page_http_code}).",
        "Confirm the URL is correct and the site is up before anything else here matters.")

if not https_enforced:
    add('CRITICAL' if page_http_code.startswith(('4', '5', '0')) else 'MEDIUM',
        "HTTP does not redirect to HTTPS." if http_final_code != '000' else "Could not confirm HTTPS enforcement (connection failed).",
        "Force a 301 redirect from http:// to https:// at the server/CDN level.")

for bot, desc, status, reason in blocked_bots:
    add('CRITICAL', f"{bot} ({desc}) is BLOCKED — {reason}.",
        f"Remove or narrow the Disallow rule for {bot} in robots.txt if you want this engine to see and cite the site.")

if not llms_exists:
    add('HIGH', "No llms.txt found — the file AI crawlers/assistants look for to understand and cite the site.",
        "Run generate_llms_txt.py to create one now (~2 minutes).")

if not schema_types:
    add('HIGH', "No JSON-LD schema markup detected anywhere on the page.",
        "Add at minimum an Organization or WebSite block — see references/schema-markup-guide.md.")

if not meta_desc:
    add('HIGH', "Meta description is missing.",
        "Write one, 120-155 characters, that states the page's value in plain language — this is often what AI engines quote verbatim.")

if not title:
    add('MEDIUM', "Title tag is missing or empty.",
        "Add a unique, descriptive <title> under ~60 characters.")
elif len(title) > 60:
    add('LOW', f"Title is {len(title)} characters — likely to get truncated in search results.",
        "Trim to ~50-60 characters, front-load the important part.")

if len(page.h1s) == 0:
    add('MEDIUM', "No H1 found on the page.",
        "Add exactly one H1 that states what the page is about in plain language.")
elif len(page.h1s) > 1:
    add('LOW', f"{len(page.h1s)} H1 tags found — should be exactly one.",
        "Demote the extras to H2/H3.")

if page.canonical is None and page_fetched_ok:
    add('LOW', "No canonical tag found.",
        "Add <link rel=\"canonical\"> pointing at the preferred URL to avoid duplicate-content ambiguity.")

if page.viewport is None and page_fetched_ok:
    add('MEDIUM', "No viewport meta tag — a basic mobile-friendliness signal.",
        "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.")

if page_fetched_ok and wc < 300:
    add('LOW', f"Thin content — about {wc} words of visible text.",
        "Pages under ~300 words rarely carry enough substance for either ranking or AI citation.")

if not llmsfull_exists and llms_exists:
    add('LOW', "llms-full.txt not found (llms.txt exists, this is the optional deeper companion file).",
        "Optional — generate_llms_txt.py can produce this too if there's more detailed content to expose.")

if not sitemap_exists:
    add('MEDIUM', "No sitemap.xml found.",
        "Add one at /sitemap.xml listing your key pages — helps search engines and AI crawlers discover content faster.")
elif not sitemap_valid:
    add('MEDIUM', "/sitemap.xml returns HTTP 200 but isn't valid XML — likely a catch-all page (common on SPAs without a real 404) instead of a real sitemap.",
        "Return an actual XML sitemap at this path, or a real 404 if none exists — a fake 200 with HTML content can mislead crawlers into thinking this is a valid sitemap.")
elif robots_exists and not sitemap_in_robots:
    add('LOW', "sitemap.xml exists but isn't referenced in robots.txt.",
        f"Add 'Sitemap: https://{HOST}/sitemap.xml' as its own line in robots.txt.")

if local_biz:
    missing_nap = [k for k, v in nap_checks.items() if not v]
    if 'telephone' in missing_nap or 'address' in missing_nap:
        add('MEDIUM', f"Local business schema is missing core NAP fields: {', '.join(missing_nap)}.",
            "Add the missing field(s) directly to the LocalBusiness JSON-LD block — see references/schema-markup-guide.md.")
    elif missing_nap:
        add('LOW', f"Local business schema is missing: {', '.join(missing_nap)}.",
            "Add the missing field(s) for a more complete local listing.")
    if not gbp_link_found:
        add('LOW', "No Google Business Profile / Maps link found on the page.",
            "Link to the Google Business Profile — reinforces the same entity across platforms.")

if gbp_result is not None:
    if gbp_result.get('found') is False:
        add('MEDIUM', f"No Google Business Profile found searching \"{gbp_result.get('query')}\" (API status: {gbp_result.get('api_status')}).",
            "Confirm the exact listing name/location, or claim/create a profile at business.google.com if one genuinely doesn't exist yet — free local visibility left on the table either way.")
    elif gbp_result.get('found') is None:
        add('LOW', f"Google Business Profile lookup failed ({gbp_result.get('error')}).",
            "Check GOOGLE_PLACES_API_KEY is valid and the Places API is enabled on that key's project, then retry.")
    elif gbp_result.get('found'):
        r = gbp_result
        if r.get('business_status', 'OPERATIONAL') != 'OPERATIONAL':
            add('CRITICAL', f"Google Business Profile is marked {r['business_status']} — invisible or flagged closed in Maps/Search.",
                "Fix the business status in the Google Business Profile dashboard immediately — this actively tells customers you're closed.")
        website = (r.get('website') or '').lower()
        if not website:
            add('MEDIUM', "Google Business Profile has no website field set.",
                f"Add {TARGET_URL} as the website in the Business Profile dashboard.")
        elif HOST.lower().replace('www.', '') not in website.replace('www.', ''):
            add('MEDIUM', f"Google Business Profile's website field points elsewhere ({r['website']}), not the audited site.",
                f"Update the website field in the Business Profile dashboard to {TARGET_URL}.")
        if not r.get('phone'):
            add('MEDIUM', "Google Business Profile has no phone number listed.",
                "Add a phone number in the Business Profile dashboard — a core trust/contact signal.")
        if not r.get('hours_present'):
            add('MEDIUM', "Google Business Profile has no hours listed.",
                "Add operating hours in the Business Profile dashboard.")
        cats = set(r.get('categories') or [])
        if not (cats - GENERIC_ONLY_TYPES):
            add('LOW', "Google Business Profile has no specific category set beyond generic defaults.",
                "Set a specific primary category (e.g. the actual business type) in the Business Profile dashboard — generic categories hurt local-search matching.")
        rating = r.get('rating')
        review_count = r.get('user_ratings_total') or 0
        if rating is not None and rating < 3.5:
            add('HIGH', f"Google Business Profile rating is {rating}/5 ({review_count} reviews).",
                "This is a real reputation problem, not a technical one — worth a direct conversation about review recovery.")
        elif rating is not None and rating < 4.0:
            add('MEDIUM', f"Google Business Profile rating is {rating}/5 ({review_count} reviews) — below the 4.0 threshold most consumers filter on.",
                "A focused review-generation push (asking happy customers directly) usually moves this fastest.")
        if review_count < 10:
            add('LOW', f"Google Business Profile has only {review_count} review(s).",
                "Low review count reads as 'new/unproven' even with a perfect rating — worth actively asking recent customers for reviews.")
        days_ago = r.get('most_recent_review_days_ago')
        if days_ago is not None and days_ago > 180:
            add('LOW', f"Most recent visible review is {days_ago} days old.",
                "Stale review activity can read as an inactive business — a steady trickle of new reviews matters more than the total count.")
        photo_count = r.get('photo_count_sample') or 0
        if photo_count < 5:
            add('LOW', f"Only {photo_count} photo(s) visible on the Google Business Profile.",
                "Add more real photos (interior, work samples, team) — profiles with more photos get measurably more clicks and direction requests.")

for score, name in [(lighthouse_scores.get('performance'), 'Performance'),
                     (lighthouse_scores.get('accessibility'), 'Accessibility'),
                     (lighthouse_scores.get('best_practices'), 'Best Practices')]:
    if score is not None and score < 90:
        sev = 'HIGH' if score < 50 else 'MEDIUM'
        add(sev, f"Lighthouse {name} score is {score}/100 ({score_tier(score)}).",
            f"See references/seo-guide.md for {name.lower()} fundamentals, or run a full Lighthouse report locally for the detailed audit trail behind this score.")

if agentic_score is not None and agentic_score < 90:
    sev = 'HIGH' if agentic_score < 50 else 'MEDIUM'
    failing = [label for label, passed, _ in agentic_checks if not passed]
    add(sev, f"Agentic Browsing score is {agentic_score}/100 — {', '.join(failing)}.",
        "Fix the failing checks above; an AI agent operating this page programmatically will hit the same walls a screen reader would.")

if crawl_pages:
    analyzed = [p for p in crawl_pages if 'error' not in p]
    missing_meta = [p['url'] for p in analyzed if 'missing meta description' in p.get('issues', [])]
    missing_schema = [p['url'] for p in analyzed if 'no schema markup' in p.get('issues', [])]
    titles_seen = {}
    for p in analyzed:
        if p.get('title'):
            titles_seen.setdefault(p['title'], []).append(p['url'])
    duplicate_title_groups = {t: urls for t, urls in titles_seen.items() if len(urls) > 1}
    if len(missing_meta) > 1:
        add('MEDIUM', f"{len(missing_meta)} of {len(analyzed)} crawled pages are missing a meta description.",
            "This is a site-wide pattern, not a one-page issue — worth fixing as a template/CMS-level change.")
    if len(missing_schema) > 1:
        add('MEDIUM', f"{len(missing_schema)} of {len(analyzed)} crawled pages have no schema markup at all.",
            "See references/schema-markup-guide.md — even baseline Organization/WebSite schema site-wide helps.")
    for dup_title, urls in duplicate_title_groups.items():
        add('MEDIUM', f"{len(urls)} crawled pages share the exact same title tag: \"{dup_title}\".",
            "Every page needs a unique title — this usually means the CMS/framework template isn't setting a per-page title. Fix at the template level, not per-page.")

findings.sort(key=lambda f: SEV_ORDER.get(f[0], 9))

# ---------------------------------------------------------------------------
# Build structured data (used for both JSON output and history/trend tracking)
# ---------------------------------------------------------------------------

https_dest_json = None if http_final_code == '000' else (http_final_url or None)
data = {
    "url": TARGET_URL,
    "elapsed_seconds": ELAPSED,
    "robots_txt": {
        "exists": robots_exists,
        "http_code": robots_http_code,
        "bots": [
            {"bot": bot, "description": desc, "status": status, "reason": reason}
            for bot, desc, status, reason in bot_results
        ],
    },
    "llms_txt": {"exists": llms_exists, "http_code": llms_status},
    "llms_full_txt": {"exists": llmsfull_exists, "http_code": llmsfull_status},
    "sitemap": {
        "exists": sitemap_exists,
        "http_code": sitemap_status,
        "url_count": len(sitemap_urls) if sitemap_valid else None,
        "is_index": sitemap_is_index,
        "referenced_in_robots": sitemap_in_robots,
    },
    "https": {
        "enforced": https_enforced,
        "http_redirect_destination": https_dest_json,
    },
    "on_page": {
        "fetched_ok": page_fetched_ok,
        "http_code": page_http_code,
        "title": title or None,
        "title_length": len(title) if title else 0,
        "meta_description": meta_desc or None,
        "meta_description_length": len(meta_desc) if meta_desc else 0,
        "h1_count": len(page.h1s),
        "h1_texts": page.h1s,
        "canonical": page.canonical,
        "viewport": page.viewport,
        "lang": page.lang,
        "word_count": wc,
    },
    "schema": {
        "found": sorted(schema_types),
        "commonly_missing": sorted(missing_high_value),
    },
    "local_seo": {
        "local_business_schema_found": local_biz is not None,
        "nap_fields": nap_checks,
        "nap_complete_count": nap_complete_count,
        "nap_total_count": nap_total_count,
        "google_business_profile_link_found": gbp_link_found,
        "same_as_links": same_as_links,
    },
    "performance": {
        "core_web_vitals": cwv,
        "proxy_ttfb_ms": ttfb_ms,
        "proxy_total_load_ms": total_ms,
        "proxy_page_weight_kb": round(page_bytes / 1024, 1) if page_bytes is not None else None,
    },
    "insights": {
        "insights_attempted": attempt_insights,
        "lighthouse_scores": lighthouse_scores or None,
        "agentic_browsing_score": agentic_score,
        "agentic_browsing_checks": [
            {"label": label, "passed": passed, "weight": weight} for label, passed, weight in agentic_checks
        ],
    },
    "google_business_profile": ({
        "attempted": attempt_gbp,
        "query": gbp_result.get('query'),
        "found": gbp_result.get('found'),
        "api_status": gbp_result.get('api_status'),
        "error": gbp_result.get('error'),
        "name": gbp_result.get('name'),
        "formatted_address": gbp_result.get('formatted_address'),
        "phone": gbp_result.get('phone'),
        "website": gbp_result.get('website'),
        "maps_url": gbp_result.get('maps_url'),
        "business_status": gbp_result.get('business_status'),
        "rating": gbp_result.get('rating'),
        "user_ratings_total": gbp_result.get('user_ratings_total'),
        "categories": gbp_result.get('categories'),
        "hours_present": gbp_result.get('hours_present'),
        "photo_count_sample": gbp_result.get('photo_count_sample'),
        "photo_count_is_capped": gbp_result.get('photo_count_is_capped'),
        "most_recent_review_days_ago": gbp_result.get('most_recent_review_days_ago'),
        "score": gbp_score,
        "checks": [{"label": label, "passed": passed, "weight": weight} for label, passed, weight in gbp_checks],
    } if gbp_result is not None else {"attempted": attempt_gbp}),
    "findings": [
        {"severity": sev, "message": msg, "fix": fix} for sev, msg, fix in findings
    ],
}
if crawl_pages is not None:
    data["crawl"] = {
        "pages_requested": CRAWL_N,
        "pages_analyzed": len(crawl_pages),
        "pages": crawl_pages,
        "duplicate_titles": [
            {"title": t, "urls": urls} for t, urls in duplicate_title_groups.items()
        ],
    }

# ---------------------------------------------------------------------------
# History / trend tracking (--history-dir)
# ---------------------------------------------------------------------------

trend = None
if HISTORY_DIR:
    def load_latest_snapshot(hist_dir):
        try:
            files = sorted(f for f in os.listdir(hist_dir) if f.startswith('audit-') and f.endswith('.json'))
        except FileNotFoundError:
            return None, None
        if not files:
            return None, None
        try:
            with open(os.path.join(hist_dir, files[-1]), 'r', encoding='utf-8') as f:
                return json.load(f), files[-1]
        except Exception:
            return None, None

    def diff_findings(prev_findings, curr_findings):
        def key(f):
            return (f['severity'], f['message'])
        prev_keys = {key(f) for f in prev_findings}
        curr_keys = {key(f) for f in curr_findings}
        resolved = [f for f in prev_findings if key(f) not in curr_keys]
        new = [f for f in curr_findings if key(f) not in prev_keys]
        return resolved, new

    prev_snapshot, prev_filename = load_latest_snapshot(HISTORY_DIR)
    if prev_snapshot:
        resolved, new = diff_findings(prev_snapshot.get('findings', []), data['findings'])
        trend = {
            "previous_snapshot": prev_filename,
            "previous_finding_count": len(prev_snapshot.get('findings', [])),
            "current_finding_count": len(data['findings']),
            "resolved": resolved,
            "new": new,
        }
        data["trend"] = trend

    try:
        os.makedirs(HISTORY_DIR, exist_ok=True)
        ts = time.strftime('%Y-%m-%dT%H-%M-%S', time.gmtime())
        snapshot_path = os.path.join(HISTORY_DIR, f'audit-{ts}.json')
        with open(snapshot_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        data["_snapshot_saved_to"] = snapshot_path
    except OSError as e:
        data["_snapshot_error"] = str(e)

# ---------------------------------------------------------------------------
# JSON mode: emit structured data instead of the human report.
# ---------------------------------------------------------------------------

if JSON_MODE:
    print(json.dumps(data, indent=2))
    sys.exit(0)

# ---------------------------------------------------------------------------
# Print the report
# ---------------------------------------------------------------------------

def line(char='-', n=60):
    print(char * n)

print()
print(f"SEO + AEO AUDIT — {TARGET_URL}")
print(f"Completed in {ELAPSED}s")
line('=')

print()
print("AI CRAWLER ACCESS (robots.txt)")
line()
if not robots_exists:
    print(f"  No robots.txt found (HTTP {robots_http_code}) — default is ALLOWED for everyone.")
for bot, desc, status, reason in bot_results:
    mark = 'OK ' if status == 'ALLOWED' else 'XX '
    print(f"  [{mark}] {bot:<20} {status:<8} — {desc}")
if blocked_bots:
    print(f"\n  {len(blocked_bots)} AI crawler(s) blocked — see prioritized fixes below.")

print()
print("LLMS.TXT STATUS")
line()
print(f"  /llms.txt       {'FOUND' if llms_exists else 'NOT FOUND'} (HTTP {llms_status})")
print(f"  /llms-full.txt  {'FOUND' if llmsfull_exists else 'NOT FOUND'} (HTTP {llmsfull_status})")

print()
print("SITEMAP.XML")
line()
if sitemap_exists:
    count_str = f"{len(sitemap_urls)} URLs listed" if sitemap_valid else "returns HTTP 200 but isn't valid XML (likely a catch-all page, not a real sitemap)"
    kind = " (this is a sitemap INDEX — lists other sitemaps, not pages directly)" if sitemap_is_index else ""
    print(f"  /sitemap.xml    FOUND — {count_str}{kind}")
    print(f"  Referenced in robots.txt: {'yes' if sitemap_in_robots else 'no'}")
else:
    print(f"  /sitemap.xml    NOT FOUND (HTTP {sitemap_status})")

print()
print("ON-PAGE SEO")
line()
if not page_fetched_ok:
    print(f"  Could not analyze — page fetch returned HTTP {page_http_code}.")
else:
    print(f"  Title:              {title or '(missing)'} ({len(title)} chars)")
    print(f"  Meta description:   {meta_desc or '(missing)'}" + (f" ({len(meta_desc)} chars)" if meta_desc else ""))
    print(f"  H1 count:           {len(page.h1s)}" + (f" — \"{page.h1s[0]}\"" if page.h1s else ""))
    print(f"  Canonical tag:      {'present' if page.canonical else 'missing'}")
    print(f"  Viewport meta:      {'present' if page.viewport else 'missing'}")
    print(f"  Lang attribute:     {page.lang or '(missing)'}")
    print(f"  Word count:         {wc}")

print()
print("SCHEMA MARKUP (JSON-LD)")
line()
if schema_types:
    print(f"  Found: {', '.join(sorted(schema_types))}")
else:
    print("  None found.")
if missing_high_value:
    print(f"  Commonly missing:   {', '.join(sorted(missing_high_value))} (add if relevant to this page)")

print()
print("LOCAL SEO")
line()
if local_biz:
    print(f"  Local business schema: found ({nap_complete_count}/{nap_total_count} NAP fields present)")
    for k, v in nap_checks.items():
        print(f"    [{'OK' if v else 'XX'}] {k}")
    print(f"  Google Business Profile / Maps link: {'found' if gbp_link_found else 'not found'}")
    print(f"  sameAs (social/profile links): {len(same_as_links)} found")
else:
    print("  No LocalBusiness-type schema found on this page.")
    print("  (Skip this section if this isn't a local/physical business — otherwise see")
    print("   references/schema-markup-guide.md for the LocalBusiness block.)")

if gbp_result is not None:
    print()
    print("GOOGLE BUSINESS PROFILE")
    line()
    if gbp_result.get('found') is True:
        r = gbp_result
        print(f"  Found: {r.get('name')} — {r.get('formatted_address') or '(no address)'}")
        print(f"  Status:             {r.get('business_status', 'OPERATIONAL')}")
        print(f"  Website field:      {r.get('website') or '(not set)'}")
        print(f"  Phone:              {r.get('phone') or '(not set)'}")
        print(f"  Hours listed:       {'yes' if r.get('hours_present') else 'no'}")
        print(f"  Category(ies):      {', '.join(r.get('categories') or []) or '(none)'}")
        rating_str = f"{r.get('rating')}/5 ({r.get('user_ratings_total') or 0} reviews)" if r.get('rating') is not None else '(no rating yet)'
        print(f"  Rating:             {rating_str}")
        photo_str = f"{r.get('photo_count_sample') or 0}{'+' if r.get('photo_count_is_capped') else ''}"
        print(f"  Photos visible:     {photo_str}")
        if r.get('most_recent_review_days_ago') is not None:
            print(f"  Most recent review: {r['most_recent_review_days_ago']} days ago")
        print(f"  Maps link:          {r.get('maps_url') or '(none)'}")
        if gbp_score is not None:
            print(f"\n  Visibility score:   {gbp_score}/100 ({score_tier(gbp_score)}) — this tool's own heuristic:")
            for label, passed, _ in gbp_checks:
                print(f"    [{'OK' if passed else 'XX'}] {label}")
    elif gbp_result.get('found') is False:
        print(f"  No listing found searching \"{gbp_result.get('query')}\" (API status: {gbp_result.get('api_status')}).")
        print("  Confirm the exact business name/location, or this may genuinely need to be claimed.")
    elif gbp_result.get('found') is None:
        print(f"  Lookup failed: {gbp_result.get('error')}")
        print("  Check GOOGLE_PLACES_API_KEY is set and the Places API is enabled on that key's project.")
    print("  (Real public data via the Google Places API — can't see post frequency, Q&A")
    print("   activity, or review-response rate; those only live in the owner's own dashboard.)")

print()
print("HTTPS & PERFORMANCE")
line()
https_dest = 'unreachable' if http_final_code == '000' else (http_final_url or 'unreachable')
print(f"  HTTPS enforced:     {'yes' if https_enforced else 'no'} (http:// -> {https_dest})")
if cwv:
    print("  Core Web Vitals (real field data, mobile):")
    print(f"    LCP:  {cwv.get('lcp') or 'no data'}")
    print(f"    CLS:  {cwv.get('cls') or 'no data'}")
    print(f"    INP:  {cwv.get('inp') or 'no data'}")
else:
    print("  Core Web Vitals:    not available (no field data, or the API call failed)")
if ttfb_ms is not None:
    print(f"  Performance proxy (curl timing, NOT real CWV):")
    print(f"    Time to first byte: {ttfb_ms}ms")
    print(f"    Total load time:    {total_ms}ms")
    if page_bytes is not None:
        print(f"    Page weight:        {page_bytes/1024:.0f} KB")

print()
print("PAGE INSIGHTS")
line()
if lighthouse_scores:
    for key, label in [('performance', 'Performance'), ('accessibility', 'Accessibility'),
                        ('best_practices', 'Best Practices')]:
        s = lighthouse_scores.get(key)
        if s is not None:
            print(f"  {label:<18}{s}/100 ({score_tier(s)})")
    print("  (real Google Lighthouse scores, mobile, via PageSpeed Insights)")
else:
    print("  Performance / Accessibility / Best Practices: not run.")
    print("  Use --insights (or set PAGESPEED_API_KEY) for real Lighthouse scores — adds ~15-45s.")
if agentic_score is not None:
    print(f"\n  Agentic Browsing  {agentic_score}/100 ({score_tier(agentic_score)}) — this tool's own heuristic:")
    for label, passed, _ in agentic_checks:
        print(f"    [{'OK' if passed else 'XX'}] {label}")

if crawl_pages is not None:
    print()
    print(f"MULTI-PAGE CRAWL ({len(crawl_pages)} pages)")
    line()
    for p in crawl_pages:
        if 'error' in p:
            print(f"  {p['url']} — {p['error']}")
        else:
            issues = ', '.join(p['issues']) if p['issues'] else 'no issues found'
            print(f"  {p['url']}")
            print(f"    {issues}")

if trend:
    print()
    print("TREND SINCE LAST AUDIT")
    line()
    print(f"  Previous audit: {trend['previous_snapshot']}")
    print(f"  Findings then:  {trend['previous_finding_count']}   Findings now: {trend['current_finding_count']}")
    if trend['resolved']:
        print(f"  Resolved ({len(trend['resolved'])}):")
        for f in trend['resolved']:
            print(f"    [FIXED] {f['message']}")
    if trend['new']:
        print(f"  New ({len(trend['new'])}):")
        for f in trend['new']:
            print(f"    [NEW] [{f['severity']}] {f['message']}")
    if not trend['resolved'] and not trend['new']:
        print("  No change since last audit.")

print()
print("PRIORITIZED NEXT STEPS")
line()
if not findings:
    print("  Nothing critical found — solid baseline on both SEO and AEO fundamentals.")
else:
    for i, (sev, msg, fix) in enumerate(findings, 1):
        print(f"  {i}. [{sev}] {msg}")
        print(f"     -> {fix}")

line('=')
print("Note: this fetches raw HTML only, like most crawlers do — content injected purely")
print("client-side by JavaScript (some schema markup, some titles on JS-heavy sites) won't")
print("show up here even though a browser would render it. Lighthouse scores (if shown) are")
print("real Google data; Agentic Browsing is this tool's own heuristic, not an industry standard.")
if gbp_result is not None:
    print("Google Business Profile data (if shown) is real, public Places API data — but that")
    print("API can't see post frequency, Q&A activity, or review-response rate, and the score")
    print("shown is this tool's own weighting of that data, not an official Google metric.")
print()
PYEOF
