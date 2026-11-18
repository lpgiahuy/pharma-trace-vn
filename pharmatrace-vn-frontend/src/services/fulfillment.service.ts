import { apiClient } from './api.client';

export interface FulfillmentPolicy {
  facility_id: number;
  facility_name: string;
  selling_facility_id: number;
  selling_facility_name: string;
  enabled: boolean;
  opens_minute: number;
  closes_minute: number;
  weekdays: number[];
  daily_capacity: number;
  radius_km: number | string;
  transport_conditions: string[];
}

export interface FulfillmentPolicyInput {
  sellingFacilityId: number; enabled: boolean; opensMinute: number; closesMinute: number;
  weekdays: number[]; dailyCapacity: number; radiusKm: number; transportConditions: string[];
}

export interface TransportRequirement {
  medicine_id: number; medicine_name: string; condition: string; min_remaining_shelf_life_days: number | null;
}

export interface WarehousePharmacyLink { warehouse_id: number; pharmacy_id: number }

export const fulfillmentService = {
  getPolicies: (): Promise<{ success: boolean; data: { policies: FulfillmentPolicy[]; requirements: TransportRequirement[]; warehouseLinks: WarehousePharmacyLink[]; defaultMinShelfLifeDays: number } }> => apiClient.get('/admin/orders/fulfillment/policies'),
  setWarehouseSellingPharmacies: (id: number, pharmacyIds: number[]) => apiClient.post(`/admin/orders/fulfillment/warehouses/${id}/selling-pharmacies`, { pharmacyIds }),
  savePolicy: (id: number, values: FulfillmentPolicyInput) => apiClient.post(`/admin/orders/fulfillment/facilities/${id}`, values),
  saveRequirement: (id: number, condition: string, minRemainingShelfLifeDays: number | null) =>
    apiClient.post(`/admin/orders/fulfillment/medicines/${id}`, { condition, minRemainingShelfLifeDays }),
  setDefaultShelfLife: (days: number) => apiClient.put('/admin/orders/fulfillment/shelf-life-default', { days }),
};
