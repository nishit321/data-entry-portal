import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, NetworkSiteKind, NetworkSiteStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  resolveTargetEntityId,
} from '../common/utils/data-scope.util';
import { CreateNetworkSiteDto, UpdateNetworkSiteDto } from './dto/network-site.dto';
import { MapQueryDto, NetworkSiteQueryDto } from './dto/geo-query.dto';
import { paginate, toSkipTake } from '../common/utils/pagination.util';

const siteSelect = {
  id: true,
  siteReference: true,
  name: true,
  kind: true,
  status: true,
  latitude: true,
  longitude: true,
  location: true,
  technology: true,
  coverageM: true,
  commissionedAt: true,
  createdAt: true,
  entity: { select: { id: true, name: true, type: true } },
} satisfies Prisma.NetworkSiteSelect;

/**
 * A point as the map needs it: coordinates as plain numbers, and enough to label a pin.
 *
 * Deliberately narrower than the list row. A map fetches every point at once, and shipping the
 * whole record for each one turns a few thousand masts into a payload nobody asked for.
 */
export interface MapPoint {
  id: string;
  kind: 'AGENT' | NetworkSiteKind;
  name: string;
  lat: number;
  lng: number;
  entity: { id: string; name: string };
  status?: NetworkSiteStatus;
  coverageM?: number | null;
}

/**
 * The network map (Phase 2): where an operator's masts, fibre nodes and agents actually are.
 *
 * Reads are scoped exactly as everywhere else — an operator sees its own network and nobody else's,
 * the Authority sees the sector and can narrow to one operator. That matters more here than on a
 * table: a competitor's mast locations are a map of where they have invested.
 */
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The site register ----------------------------------------------------

  async findAll(user: AuthUser, query: NetworkSiteQueryDto) {
    const scoped = entityScopeFilter(user); // operator -> own id; authority -> undefined
    const where: Prisma.NetworkSiteWhereInput = {
      deletedAt: null,
      entityId: scoped ?? query.entityId,
      kind: query.kind,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { siteReference: { contains: query.search, mode: 'insensitive' } },
              { location: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.NetworkSiteOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.networkSite.findMany({ where, select: siteSelect, orderBy, skip, take }),
      this.prisma.networkSite.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async create(user: AuthUser, dto: CreateNetworkSiteDto, ctx: RequestContext) {
    const entityId = resolveTargetEntityId(user, dto.entityId);
    this.assertCoordinates(dto.latitude, dto.longitude);

    const clash = await this.prisma.networkSite.findFirst({
      where: { entityId, siteReference: dto.siteReference.trim(), deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException('A site with this reference is already on the register.');
    }

    const site = await this.prisma.networkSite.create({
      data: {
        entityId,
        siteReference: dto.siteReference.trim(),
        name: dto.name.trim(),
        kind: dto.kind ?? NetworkSiteKind.BASE_STATION,
        status: dto.status ?? NetworkSiteStatus.ACTIVE,
        latitude: new Prisma.Decimal(dto.latitude),
        longitude: new Prisma.Decimal(dto.longitude),
        location: dto.location?.trim() || null,
        technology: dto.technology?.trim() || null,
        coverageM: dto.coverageM ?? null,
        commissionedAt: dto.commissionedAt ? new Date(dto.commissionedAt) : null,
      },
      select: siteSelect,
    });
    await this.record(AuditAction.NETWORK_SITE_CREATED, site.id, user.id, ctx, {
      entityId,
      kind: site.kind,
    });
    return site;
  }

  async update(user: AuthUser, id: string, dto: UpdateNetworkSiteDto, ctx: RequestContext) {
    const existing = await this.prisma.networkSite.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true },
    });
    if (!existing) throw new NotFoundException('That site is not on the register.');
    assertCanAccessEntity(user, existing.entityId);

    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      // A half-supplied coordinate would silently move a site onto the equator or the meridian.
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException('Give both a latitude and a longitude, or neither.');
      }
      this.assertCoordinates(dto.latitude, dto.longitude);
    }

    const site = await this.prisma.networkSite.update({
      where: { id },
      data: {
        siteReference: dto.siteReference?.trim(),
        name: dto.name?.trim(),
        kind: dto.kind,
        status: dto.status,
        latitude: dto.latitude === undefined ? undefined : new Prisma.Decimal(dto.latitude),
        longitude: dto.longitude === undefined ? undefined : new Prisma.Decimal(dto.longitude),
        location: dto.location === undefined ? undefined : dto.location.trim() || null,
        technology: dto.technology === undefined ? undefined : dto.technology.trim() || null,
        coverageM: dto.coverageM,
        commissionedAt: dto.commissionedAt === undefined ? undefined : new Date(dto.commissionedAt),
      },
      select: siteSelect,
    });
    await this.record(AuditAction.NETWORK_SITE_UPDATED, id, user.id, ctx, { changes: { ...dto } });
    return site;
  }

  async remove(user: AuthUser, id: string, ctx: RequestContext) {
    const existing = await this.prisma.networkSite.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true },
    });
    if (!existing) throw new NotFoundException('That site is not on the register.');
    assertCanAccessEntity(user, existing.entityId);

    await this.prisma.networkSite.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.NETWORK_SITE_DELETED, id, user.id, ctx);
    return { message: 'Site removed from the register' };
  }

  // --- The map ---------------------------------------------------------------

  /**
   * Every point the reader may see, in one call.
   *
   * A map is a single view, so it is one request rather than one per layer: the client toggles
   * layers on and off without going back to the server, which is what makes a map feel like a map
   * rather than a form. The payload is bounded by `MAX_POINTS` so a large register degrades into a
   * truncated map with a warning, rather than a page that never finishes loading.
   */
  async map(user: AuthUser, query: MapQueryDto) {
    const scoped = entityScopeFilter(user);
    const entityId = scoped ?? query.entityId;
    const limit = query.limit ?? 5000;

    const [sites, agents] = await Promise.all([
      this.prisma.networkSite.findMany({
        where: { deletedAt: null, entityId, kind: query.kind, status: query.status },
        select: {
          id: true,
          name: true,
          kind: true,
          status: true,
          latitude: true,
          longitude: true,
          coverageM: true,
          entity: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      // Agents already carry coordinates, but only some are filled in; the rest cannot be mapped.
      query.includeAgents === false
        ? []
        : this.prisma.agent.findMany({
            where: {
              deletedAt: null,
              isActive: true,
              entityId,
              latitude: { not: null },
              longitude: { not: null },
            },
            select: {
              id: true,
              name: true,
              latitude: true,
              longitude: true,
              entity: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
    ]);

    const points: MapPoint[] = [
      ...sites.map((s) => ({
        id: s.id,
        kind: s.kind,
        name: s.name,
        lat: Number(s.latitude),
        lng: Number(s.longitude),
        status: s.status,
        coverageM: s.coverageM,
        entity: s.entity,
      })),
      ...agents.map((a) => ({
        id: a.id,
        kind: 'AGENT' as const,
        name: a.name,
        lat: Number(a.latitude),
        lng: Number(a.longitude),
        entity: a.entity,
      })),
    ];

    return {
      points,
      /** True when the cap bit, so the map can say it is showing part of the picture. */
      truncated: sites.length === limit || agents.length === limit,
      counts: {
        sites: sites.length,
        agents: agents.length,
      },
    };
  }

  /**
   * Coordinates have to be on the planet, and (0, 0) is almost always a form that was left blank
   * rather than a site in the Gulf of Guinea.
   */
  private assertCoordinates(latitude: number, longitude: number) {
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90.');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180.');
    }
    if (latitude === 0 && longitude === 0) {
      throw new BadRequestException('Enter the site coordinates. Zero and zero is out at sea.');
    }
  }

  private record(
    action: AuditAction,
    siteId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'NetworkSite',
      entityId: siteId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
