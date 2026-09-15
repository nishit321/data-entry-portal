import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { OperatorUsersController } from './operator-users.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, OperatorUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
