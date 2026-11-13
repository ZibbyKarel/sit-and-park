import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { DeskCleanupService } from './desk-cleanup.service';
import { DeskRequestsService } from './desk-requests.service';
import { DesksController } from './desks.controller';
import { DesksService } from './desks.service';

/**
 * The caller-facing `desk.*` procedures. `ReservationsModule` is imported for
 * its one after-commit `DomainEventPublisher` (see the comment on its
 * `exports`). `DeskCleanupService` is exported for the admin desk module and
 * the employee sync, which run the same clean-up inside their own transactions.
 */
@Module({
  imports: [AuditModule, ReservationsModule],
  controllers: [DesksController],
  providers: [DesksService, DeskRequestsService, DeskCleanupService],
  exports: [DeskCleanupService],
})
export class DesksModule {}
