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
import {
  CreateFibreLinkDto,
  FibreLinkQueryDto,
  UpdateFibreLinkDto,
  MAX_ROUTE_POINTS,
  type RoutePoint,
} from './dto/fibre-link.dto';
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

const linkSelect = {
  id: true,
  linkReference: true,
  name: true,
  status: true,
  lengthKm: true,
  capacityGbps: true,
  path: true,
  commissionedAt: true,
  createdAt: true,
  entity: { select: { id: true, name: true, type: true } },
  fromSite: { select: { id: true, name: true, siteReference: true } },
  toSite: { select: { id: true, name: true, siteReference: true } },
} satisfies Prisma.FibreLinkSelect;

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
 * A route as the map needs it: the line to draw, and whether it is the real one.
 *
 * `surveyed` is the field that keeps the map honest. A straight line between two nodes looks
 * exactly like a surveyed route and is not one, so the map has to be able to draw the two
 * differently. Without it, a reader would take every link on the screen as a cable run somebody
 * has walked.
 */
export interface MapRoute {
  id: string;
  name: string;
  status: NetworkSiteStatus;
  /** Ordered [latitude, longitude] pairs, ready to draw. */
  path: RoutePoint[];
  /** True when the operator supplied the geometry; false when this is the straight line. */
  surveyed: boolean;
  lengthKm: number | null;
  capacityGbps: number | null;
  entity: { id: string; name: string };
  from: string;
  to: string;
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

  /**
   * One site by id.
   *
   * Here so a picker can name a site that is already selected. A register runs to thousands of
   * rows, so the list endpoint cannot be relied on to have the chosen one on the page in front of
   * the reader, and an id rendered raw where a name should be is how a form stops making sense
   * after a reload.
   */
  async findOne(user: AuthUser, id: string) {
    const site = await this.prisma.networkSite.findFirst({
      where: { id, deletedAt: null },
      select: siteSelect,
    });
    if (!site) throw new NotFoundException('That site is not on the register.');
    assertCanAccessEntity(user, site.entity.id);
    return site;
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

    const [sites, agents, links] = await Promise.all([
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
      /*
       * Routes are not filtered by `kind`: a site kind says what a node is, and a route is not a
       * node. Filtering the map to base stations and quietly dropping every fibre run would leave
       * a reader thinking the operator has none.
       */
      this.prisma.fibreLink.findMany({
        where: { deletedAt: null, entityId, status: query.status },
        select: {
          id: true,
          name: true,
          status: true,
          lengthKm: true,
          capacityGbps: true,
          path: true,
          entity: { select: { id: true, name: true } },
          fromSite: { select: { name: true, latitude: true, longitude: true } },
          toSite: { select: { name: true, latitude: true, longitude: true } },
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

    const routes: MapRoute[] = links.map((link) => {
      const surveyed = toRoutePoints(link.path);
      return {
        id: link.id,
        name: link.name,
        status: link.status,
        // The straight line is the fallback, not a stored value: it is derived from wherever the
        // two nodes are now, so moving a node moves the line with it.
        path: surveyed ?? [
          [Number(link.fromSite.latitude), Number(link.fromSite.longitude)],
          [Number(link.toSite.latitude), Number(link.toSite.longitude)],
        ],
        surveyed: surveyed !== null,
        lengthKm: link.lengthKm === null ? null : Number(link.lengthKm),
        capacityGbps: link.capacityGbps,
        entity: link.entity,
        from: link.fromSite.name,
        to: link.toSite.name,
      };
    });

    return {
      points,
      routes,
      /** True when the cap bit, so the map can say it is showing part of the picture. */
      truncated: sites.length === limit || agents.length === limit || links.length === limit,
      counts: {
        sites: sites.length,
        agents: agents.length,
        routes: links.length,
      },
    };
  }

  // --- Fibre routes ----------------------------------------------------------

  async findAllLinks(user: AuthUser, query: FibreLinkQueryDto) {
    const scoped = entityScopeFilter(user);
    const where: Prisma.FibreLinkWhereInput = {
      deletedAt: null,
      entityId: scoped ?? query.entityId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { linkReference: { contains: query.search, mode: 'insensitive' } },
              { fromSite: { name: { contains: query.search, mode: 'insensitive' } } },
              { toSite: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.FibreLinkOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fibreLink.findMany({ where, select: linkSelect, orderBy, skip, take }),
      this.prisma.fibreLink.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async createLink(user: AuthUser, dto: CreateFibreLinkDto, ctx: RequestContext) {
    const entityId = resolveTargetEntityId(user, dto.entityId);
    await this.assertEndpoints(entityId, dto.fromSiteId, dto.toSiteId);
    const path = this.normalisePath(dto.path);

    const clash = await this.prisma.fibreLink.findFirst({
      where: { entityId, linkReference: dto.linkReference.trim(), deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException('A route with this reference is already on the register.');
    }

    const link = await this.prisma.fibreLink.create({
      data: {
        entityId,
        linkReference: dto.linkReference.trim(),
        name: dto.name.trim(),
        status: dto.status ?? NetworkSiteStatus.ACTIVE,
        fromSiteId: dto.fromSiteId,
        toSiteId: dto.toSiteId,
        lengthKm: dto.lengthKm === undefined ? null : new Prisma.Decimal(dto.lengthKm),
        capacityGbps: dto.capacityGbps ?? null,
        path: path ?? Prisma.DbNull,
        commissionedAt: dto.commissionedAt ? new Date(dto.commissionedAt) : null,
      },
      select: linkSelect,
    });
    await this.recordLink(AuditAction.FIBRE_LINK_CREATED, link.id, user.id, ctx, {
      entityId,
      surveyed: path !== null,
    });
    return link;
  }

  async updateLink(user: AuthUser, id: string, dto: UpdateFibreLinkDto, ctx: RequestContext) {
    const existing = await this.prisma.fibreLink.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true, fromSiteId: true, toSiteId: true },
    });
    if (!existing) throw new NotFoundException('That route is not on the register.');
    assertCanAccessEntity(user, existing.entityId);

    if (dto.fromSiteId !== undefined || dto.toSiteId !== undefined) {
      await this.assertEndpoints(
        existing.entityId,
        dto.fromSiteId ?? existing.fromSiteId,
        dto.toSiteId ?? existing.toSiteId,
      );
    }
    // An empty array is how a surveyed route is taken off; undefined leaves it alone.
    const path = dto.path === undefined ? undefined : this.normalisePath(dto.path);

    const link = await this.prisma.fibreLink.update({
      where: { id },
      data: {
        linkReference: dto.linkReference?.trim(),
        name: dto.name?.trim(),
        status: dto.status,
        fromSiteId: dto.fromSiteId,
        toSiteId: dto.toSiteId,
        lengthKm: dto.lengthKm === undefined ? undefined : new Prisma.Decimal(dto.lengthKm),
        capacityGbps: dto.capacityGbps,
        path: path === undefined ? undefined : (path ?? Prisma.DbNull),
        commissionedAt: dto.commissionedAt === undefined ? undefined : new Date(dto.commissionedAt),
      },
      select: linkSelect,
    });
    await this.recordLink(AuditAction.FIBRE_LINK_UPDATED, id, user.id, ctx, {
      changes: { ...dto, path: path === undefined ? undefined : `${path?.length ?? 0} points` },
    });
    return link;
  }

  async removeLink(user: AuthUser, id: string, ctx: RequestContext) {
    const existing = await this.prisma.fibreLink.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true },
    });
    if (!existing) throw new NotFoundException('That route is not on the register.');
    assertCanAccessEntity(user, existing.entityId);

    await this.prisma.fibreLink.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.recordLink(AuditAction.FIBRE_LINK_DELETED, id, user.id, ctx);
    return { message: 'Route removed from the register' };
  }

  /**
   * Both ends must be this operator's own nodes, and they must be two different ones.
   *
   * The scoping check that matters on this table. A route names two sites by id, so without this
   * an operator could join one of their nodes to a competitor's and read its coordinates straight
   * back off the map — the one thing the whole module is scoped to prevent.
   */
  private async assertEndpoints(entityId: string, fromSiteId: string, toSiteId: string) {
    if (fromSiteId === toSiteId) {
      throw new BadRequestException('A route has to join two different nodes.');
    }
    const sites = await this.prisma.networkSite.findMany({
      where: { id: { in: [fromSiteId, toSiteId] }, entityId, deletedAt: null },
      select: { id: true },
    });
    if (sites.length !== 2) {
      throw new BadRequestException(
        "Both ends of a route have to be sites on this operator's own register.",
      );
    }
  }

  /**
   * Check a supplied route and hand back the points to store, or null for "no survey".
   *
   * An empty array means the operator is taking a route off and going back to the straight line,
   * which is the same stored state as never having had one.
   */
  private normalisePath(path: RoutePoint[] | undefined): RoutePoint[] | null {
    if (path === undefined || path.length === 0) return null;
    if (path.length < 2) throw new BadRequestException('A route needs at least two points.');
    if (path.length > MAX_ROUTE_POINTS) {
      throw new BadRequestException(
        `A route can carry up to ${MAX_ROUTE_POINTS} points. Simplify it before uploading.`,
      );
    }
    return path.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new BadRequestException(
          `Point ${index + 1} of the route is not a latitude and longitude pair.`,
        );
      }
      const [lat, lng] = point.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new BadRequestException(`Point ${index + 1} of the route is not a pair of numbers.`);
      }
      // The same rule the site register applies, for the same reason: a route that runs through
      // (0, 0) is a row somebody left half filled in, not a cable in the Gulf of Guinea.
      this.assertCoordinates(lat, lng);
      return [lat, lng] as RoutePoint;
    });
  }

  private recordLink(
    action: AuditAction,
    linkId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'FibreLink',
      entityId: linkId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
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

/**
 * Read a stored route back into points, or null when there is no usable survey.
 *
 * Defensive on purpose. `path` is a JSON column, so what comes back is whatever was written — and
 * the one thing the map must not do is throw while drawing. A row that cannot be read as a route
 * falls back to the straight line, which is the same thing a route with no survey gets.
 */
function toRoutePoints(value: unknown): RoutePoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points: RoutePoint[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const lat = Number(entry[0]);
    const lng = Number(entry[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    points.push([lat, lng]);
  }
  return points;
}
