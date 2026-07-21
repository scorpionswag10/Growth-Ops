import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateOpportunityDto,
  CreatePipelineDto,
  UpdateOpportunityDto,
} from "./dto";

@Injectable()
export class PipelinesService {
  constructor(private prisma: PrismaService) {}

  create(locationId: string, dto: CreatePipelineDto) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.pipeline.create({
        data: {
          locationId,
          name: dto.name,
          stages: {
            create: dto.stages.map((name, i) => ({
              locationId,
              name,
              position: i,
            })),
          },
        },
        include: { stages: { orderBy: { position: "asc" } } },
      }),
    );
  }

  list(locationId: string) {
    return this.prisma.withLocation(locationId, (tx) =>
      tx.pipeline.findMany({
        include: { stages: { orderBy: { position: "asc" } } },
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  /** The kanban view: stages in order, cards with contact summaries. */
  async board(locationId: string, pipelineId: string) {
    const pipeline = await this.prisma.withLocation(locationId, (tx) =>
      tx.pipeline.findUnique({
        where: { id: pipelineId },
        include: {
          stages: {
            orderBy: { position: "asc" },
            include: {
              opportunities: {
                where: { status: "OPEN" },
                orderBy: { updatedAt: "desc" },
                include: {
                  contact: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true,
                      phone: true,
                      tags: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    if (!pipeline) throw new NotFoundException("Pipeline not found");
    return pipeline;
  }

  createOpportunity(
    locationId: string,
    pipelineId: string,
    dto: CreateOpportunityDto,
  ) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const pipeline = await tx.pipeline.findUnique({
        where: { id: pipelineId },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline) throw new NotFoundException("Pipeline not found");

      const stageId = dto.stageId ?? pipeline.stages[0]?.id;
      if (!stageId || !pipeline.stages.some((s) => s.id === stageId)) {
        throw new BadRequestException("Stage does not belong to this pipeline");
      }
      return tx.opportunity.create({
        data: {
          locationId,
          pipelineId,
          stageId,
          contactId: dto.contactId,
          name: dto.name,
          monetaryValue: dto.monetaryValue ?? 0,
        },
      });
    });
  }

  updateOpportunity(
    locationId: string,
    opportunityId: string,
    dto: UpdateOpportunityDto,
  ) {
    return this.prisma.withLocation(locationId, async (tx) => {
      const opp = await tx.opportunity.findUnique({
        where: { id: opportunityId },
      });
      if (!opp) throw new NotFoundException("Opportunity not found");

      if (dto.stageId) {
        const stage = await tx.pipelineStage.findUnique({
          where: { id: dto.stageId },
        });
        if (!stage || stage.pipelineId !== opp.pipelineId) {
          throw new BadRequestException(
            "Stage does not belong to this opportunity's pipeline",
          );
        }
      }
      return tx.opportunity.update({
        where: { id: opportunityId },
        data: dto,
      });
    });
  }
}
