import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeeSyncModule } from '../employee-sync/employee-sync.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule, EmployeeSyncModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
