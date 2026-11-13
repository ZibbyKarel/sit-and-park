import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DesksModule } from '../desks/desks.module';
import { DeskAdminController } from './desk-admin.controller';
import { DeskAdminService } from './desk-admin.service';
import { HiveAdminService } from './hive-admin.service';
import { OfficeAdminService } from './office-admin.service';

/** Admin desk, hive, office and zone management. `DesksModule` provides the shared clean-up. */
@Module({
  imports: [AuditModule, DesksModule],
  controllers: [DeskAdminController],
  providers: [DeskAdminService, HiveAdminService, OfficeAdminService],
})
export class DeskAdminModule {}
