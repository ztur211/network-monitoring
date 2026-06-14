/** Injection token for PermissionsService — used to break the circular import
 *  between PropertiesModule and PermissionsModule without a value-level import
 *  of PermissionsService inside properties.service.ts. */
export const PERMISSIONS_SERVICE = 'PERMISSIONS_SERVICE';
