import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { UserDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { GEOCODING_PROVIDER, GeocodingProvider } from '../map/geocoding/geocoding.interface';
import { UpdateMeDto, SetLocationDto } from './users.dto';
import { UsersRepository } from './users.repository';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    @Inject(GEOCODING_PROVIDER) private readonly geocodingProvider: GeocodingProvider,
  ) {}

  async getMe(userId: string): Promise<UserDto> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NodeScopeException('GEN_002', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserDto> {
    if (dto.email) {
      const taken = await this.usersRepository.existsByEmail(dto.email, userId);
      if (taken) {
        throw new NodeScopeException('AUTH_005', 'EMAIL_TAKEN', HttpStatus.CONFLICT);
      }
    }

    const updated = await this.usersRepository.update(userId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.email !== undefined && { email: dto.email }),
    });

    return this.toDto(updated);
  }

  async setLocation(
    userId: string,
    dto: SetLocationDto,
  ): Promise<{ latitude: number; longitude: number; address: string | null }> {
    if (!dto.address && dto.latitude === undefined) {
      throw new NodeScopeException(
        'GEN_001',
        'Either address or latitude+longitude must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.address) {
      const result = await this.geocodingProvider.geocode(dto.address);
      if (!result) {
        throw new NodeScopeException('MAP_001', 'GEOCODING_FAILED', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      await this.usersRepository.updateLocation(userId, result.latitude, result.longitude);
      return { latitude: result.latitude, longitude: result.longitude, address: result.displayName };
    }

    const lat = dto.latitude as number;
    const lng = dto.longitude as number;
    const updated = await this.usersRepository.updateLocation(userId, lat, lng);

    return {
      latitude: updated.homeLatitude as number,
      longitude: updated.homeLongitude as number,
      address: null,
    };
  }

  private toDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tier: user.tier as UserDto['tier'],
      homeLatitude: user.homeLatitude,
      homeLongitude: user.homeLongitude,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
