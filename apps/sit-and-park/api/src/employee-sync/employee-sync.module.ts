import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DesksModule } from '../desks/desks.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { EmployeeSyncAdminController } from './employee-sync-admin.controller';
import { EmployeeSyncController } from './employee-sync.controller';
import { EmployeeSyncService } from './employee-sync.service';
import { UserDeactivationService } from './user-deactivation.service';

/**
 * `UserDeactivationService` is exported for `UsersModule`: an admin
 * deactivating a user goes through the same clean-up as the sync.
 */
@Module({
  imports: [AuditModule, ReservationsModule, DesksModule],
  controllers: [EmployeeSyncController, EmployeeSyncAdminController],
  providers: [EmployeeSyncService, UserDeactivationService],
  exports: [UserDeactivationService],
})
export class EmployeeSyncModule {}
