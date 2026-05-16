import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '@nodescope/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateMeDto, SetLocationDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.usersService.getMe(user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    const data = await this.usersService.updateMe(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Post('location')
  async setLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetLocationDto) {
    const data = await this.usersService.setLocation(user.id, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('me/data-sources')
  async getDataSources(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.usersService.getDataSources(user.id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
