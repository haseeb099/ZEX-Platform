import { Module } from '@nestjs/common';
import { TenantConfigController } from './tenant-config.controller';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController, TenantConfigController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantsModule {}
