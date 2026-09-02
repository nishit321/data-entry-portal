import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { OperatorUsersController } from './operator-users.controller';

@Module({
  controllers: [UsersController, OperatorUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
