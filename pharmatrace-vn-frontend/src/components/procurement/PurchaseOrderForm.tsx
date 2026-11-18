'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Card, Form, Input, InputNumber, Select } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import {
  purchaseOrderService, type PurchaseOrderDetail, type PurchaseOrderInput, type PurchaseOrderOptions,
} from '@/services/purchaseOrder.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCurrency } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

type Variant = PurchaseOrderOptions['variants'][number];

interface FormValues {
  facilityId?: number;
  supplier?: string;
  expectedAt?: string;
  note?: string;
  lines?: { variantId?: number; quantity?: number; unitPrice?: number }[];
}

const variantLabel = (variant: Variant) => `${variant.medicine.medicine_name} (${variant.unit_name})`;

function initialValues(order: PurchaseOrderDetail): FormValues {
  return {
    supplier: order.supplier ? `f:${order.supplier.id}` : `m:${order.supplier_manufacturer?.id}`,
    expectedAt: order.expected_at?.slice(0, 10),
    note: order.note ?? undefined,
    lines: order.purchase_order_items.map(item => ({ variantId: item.variant_id ?? undefined, quantity: item.quantity, unitPrice: Number(item.unit_price) })),
  };
}

/** Create form, or edit form when `order` is given. The server recomputes the total. */
export function PurchaseOrderForm({ order }: { order?: PurchaseOrderDetail }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [options, setOptions] = useState<PurchaseOrderOptions>();
  const [variants, setVariants] = useState<Variant[]>(
    order?.purchase_order_items.flatMap(item => (item.variant_id === null ? [] : [{
      id: item.variant_id, unit_name: item.packaging_variants?.unit_name ?? '', medicine: { medicine_name: item.medicines.medicine_name },
    }])) ?? [],
  );
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const getUser = useAuthStore(state => state.getUser);
  const admin = useHydrated() && getUser()?.role === 'SUPER_ADMIN';
  const lines = Form.useWatch('lines', form);
  const total = (lines ?? []).reduce((sum, line) => sum + (line?.quantity ?? 0) * (line?.unitPrice ?? 0), 0);

  const search = (text?: string) => purchaseOrderService.options(text)
    .then(res => {
      setOptions(res.data);
      setVariants(known => [...known, ...res.data.variants.filter(found => !known.some(variant => variant.id === found.id))]);
    })
    .catch(() => setError(true));

  useEffect(() => { search(); }, []);

  const submit = async (values: FormValues) => {
    const [kind, id] = (values.supplier ?? '').split(':');
    const input: PurchaseOrderInput = {
      ...(admin && !order ? { facilityId: values.facilityId } : {}),
      ...(kind === 'f' ? { supplierFacilityId: Number(id) } : { supplierManufacturerId: Number(id) }),
      expectedAt: values.expectedAt || undefined,
      note: values.note?.trim() || undefined,
      lines: (values.lines ?? []).map(line => ({ variantId: line.variantId as number, quantity: line.quantity as number, unitPrice: line.unitPrice as number })),
    };
    setSaving(true);
    try {
      const saved = order ? await purchaseOrderService.update(order.id, input) : await purchaseOrderService.create(input);
      message.success(order ? 'Purchase order updated' : 'Purchase order created');
      router.push(`/warehouse/purchase-orders/${saved.data.id}`);
    } catch (err) {
      message.error(workflowErrorMessage(err, 'We could not save the purchase order.'));
      setSaving(false);
    }
  };

  const supplierOptions = [
    { label: 'Manufacturers', options: (options?.manufacturers ?? []).map(item => ({ value: `m:${item.id}`, label: item.name })) },
    { label: 'Factories', options: (options?.factories ?? []).map(item => ({ value: `f:${item.id}`, label: item.facility_name })) },
  ];

  return (
    <Form
      form={form} layout="vertical" onFinish={submit} className="max-w-3xl"
      initialValues={order ? initialValues(order) : { lines: [{}] }}
    >
      <h1 className="mt-0 text-lg font-bold text-slate-900">{order ? `Edit ${order.po_code}` : 'New purchase order'}</h1>
      {error && <Alert className="mb-4" type="error" showIcon title="We could not load suppliers and products. Please reload the page." />}
      {admin && !order && (
        <Form.Item name="facilityId" label="Receiving warehouse" rules={[{ required: true, message: 'Choose a warehouse' }]}>
          <Select options={(options?.warehouses ?? []).map(item => ({ value: item.id, label: item.facility_name }))} />
        </Form.Item>
      )}
      <Form.Item name="supplier" label="Supplier" rules={[{ required: true, message: 'Choose a supplier' }]}>
        <Select showSearch={{ optionFilterProp: 'label' }} options={supplierOptions} />
      </Form.Item>
      <Form.Item name="expectedAt" label="Expected delivery date"><Input type="date" className="w-48" /></Form.Item>
      <Form.Item name="note" label="Note"><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>

      <Card size="small" title="Products" className="mb-4">
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map(field => (
                <div key={field.key} className="mb-2 flex flex-wrap items-start gap-2">
                  <Form.Item name={[field.name, 'variantId']} rules={[{ required: true, message: 'Choose a product' }]} className="mb-0 min-w-64 flex-1">
                    <Select
                      showSearch={{ filterOption: false, onSearch: search }}
                      placeholder="Search a product"
                      options={variants.map(variant => ({ value: variant.id, label: variantLabel(variant) }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'quantity']} rules={[{ required: true, message: 'Quantity' }]} className="mb-0">
                    <InputNumber min={1} max={1_000_000} precision={0} placeholder="Qty" aria-label="Quantity" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'unitPrice']} rules={[{ required: true, message: 'Unit price' }]} className="mb-0">
                    <InputNumber min={0} precision={2} placeholder="Unit price" aria-label="Unit price" />
                  </Form.Item>
                  {fields.length > 1 && <Button aria-label="Remove product" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(field.name)} />}
                </div>
              ))}
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => add({})}>Add product</Button>
            </>
          )}
        </Form.List>
        <div className="mt-3 text-right text-sm text-slate-600">Estimated total: <strong>{formatCurrency(total)}</strong></div>
      </Card>

      <div className="flex gap-2">
        <Button type="primary" htmlType="submit" loading={saving}>{order ? 'Save changes' : 'Create purchase order'}</Button>
        <Button onClick={() => router.back()}>Cancel</Button>
      </div>
    </Form>
  );
}
