import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantService } from './tenant.service';

@ApiTags('admin/tenants')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const tenant = await this.tenants.getTenantSafe(id);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}
