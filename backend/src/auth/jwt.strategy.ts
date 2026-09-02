import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtConfig } from '../config/configuration';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  entityId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<JwtConfig>('jwt')!.secret,
    });
  }

  // The returned object becomes request.user
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Your session is no longer valid. Sign in again.');
    }
    // entityId is read from the DB (not trusted from the token) so a changed
    // entity assignment takes effect on the next request.
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      entityId: user.entityId,
    };
  }
}
