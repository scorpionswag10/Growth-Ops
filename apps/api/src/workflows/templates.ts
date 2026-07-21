import { WorkflowTrigger } from "@growthops/db";

/**
 * Workflow step shapes. A workflow is an ordered list of these, stored as
 * JSON on the Workflow row and snapshotted onto every execution.
 */
export type WorkflowStep =
  | { type: "send_message"; channel: "SMS" | "EMAIL" | "NOTE"; template: string }
  | { type: "wait"; seconds?: number; minutes?: number; hours?: number; days?: number }
  | { type: "wait_until"; anchor: "appointment_start"; offsetHours: number }
  | { type: "add_tag"; tags: string[] };

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  stopOnReply: boolean;
  steps: WorkflowStep[];
}

/**
 * The vertical-default catalog: proven automations for appointment-based
 * local businesses, stamped into ANY location and tuned per client after.
 * Placeholders: {{firstName}} {{businessName}} {{appointmentTime}}.
 */
export const TEMPLATE_CATALOG: WorkflowTemplate[] = [
  {
    key: "lead-follow-up",
    name: "Instant lead follow-up",
    description:
      "The moment a new lead comes in: instant text, then a next-day nudge if they never replied.",
    trigger: "CONTACT_CREATED",
    stopOnReply: true,
    steps: [
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}! Thanks for reaching out to {{businessName}} — what day works best for you? Reply here and we'll get you scheduled.",
      },
      { type: "wait", days: 1 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, just making sure you saw our message — we'd love to get you booked at {{businessName}}. Any questions I can answer?",
      },
      { type: "add_tag", tags: ["followed-up"] },
    ],
  },
  {
    key: "appointment-reminder",
    name: "Appointment reminders",
    description: "Reminder 24 hours before, and again 2 hours before.",
    trigger: "APPOINTMENT_BOOKED",
    stopOnReply: false,
    steps: [
      { type: "wait_until", anchor: "appointment_start", offsetHours: -24 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, reminder: your appointment at {{businessName}} is tomorrow — {{appointmentTime}}. Reply if you need to reschedule.",
      },
      { type: "wait_until", anchor: "appointment_start", offsetHours: -2 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "See you soon, {{firstName}}! Your appointment at {{businessName}} is at {{appointmentTime}}.",
      },
    ],
  },
  {
    key: "appointment-recovery",
    name: "No-show recovery",
    description:
      "When someone misses an appointment: a same-day rebook text, then one more two days later.",
    trigger: "APPOINTMENT_NO_SHOW",
    stopOnReply: true,
    steps: [
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, we missed you at {{businessName}} today. Life happens — want to grab a new time? Reply here and we'll set it up.",
      },
      { type: "wait", days: 2 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, still holding a spot for you at {{businessName}}. Want me to find you a time this week?",
      },
      { type: "add_tag", tags: ["no-show-recovery"] },
    ],
  },
  {
    key: "review-request",
    name: "Review request",
    description:
      "After a completed appointment: thank-you plus a review ask a few hours later.",
    trigger: "APPOINTMENT_COMPLETED",
    stopOnReply: false,
    steps: [
      { type: "wait", hours: 3 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Thanks for coming in today, {{firstName}}! If you had a great experience at {{businessName}}, a quick Google review would mean the world to us.",
      },
      { type: "add_tag", tags: ["review-requested"] },
    ],
  },
  {
    key: "reactivation",
    name: "Customer reactivation",
    description:
      "Manually enroll lapsed customers: a warm we-miss-you text with a booking nudge.",
    trigger: "MANUAL",
    stopOnReply: true,
    steps: [
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, it's been a while since your last visit to {{businessName}} — we'd love to see you again. Want me to find you a time?",
      },
      { type: "wait", days: 3 },
      {
        type: "send_message",
        channel: "SMS",
        template:
          "Hi {{firstName}}, spots are open this week at {{businessName}} if you'd like to come back in. Just reply and we'll book you.",
      },
      { type: "add_tag", tags: ["reactivation"] },
    ],
  },
];
