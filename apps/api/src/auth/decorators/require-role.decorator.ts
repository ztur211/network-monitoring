import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLE_KEY = 'requiredRole';
export const RequireRole = (role: string) => SetMetadata(REQUIRED_ROLE_KEY, role);
