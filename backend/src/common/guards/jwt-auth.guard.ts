import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../constants/app.constants';
import { IS_MACHINE_ROUTE_KEY } from '../../machine-api/machine.decorators';

/**
 * Global authentication guard. Validates the JWT for every route unless the
 * handler or controller is marked with @Public() or @MachineRoute().
 *
 * A machine route is not public: it carries credentials of a different kind, and `MachineAuthGuard`
 * on the controller does that work. This guard only steps aside so it can.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const isMachineRoute = this.reflector.getAllAndOverride<boolean>(IS_MACHINE_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isMachineRoute) {
      return true;
    }
    return super.canActivate(context);
  }
}
