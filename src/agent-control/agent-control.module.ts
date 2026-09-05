import { Module } from '@nestjs/common';
import { AuditModule } from '@src/audit/audit.module';
import { AgentControlController } from './agent-control.controller';
import { AgentControlService } from './agent-control.service';

@Module({
  imports: [AuditModule],
  controllers: [AgentControlController],
  providers: [AgentControlService],
  exports: [AgentControlService],
})
export class AgentControlModule {}
