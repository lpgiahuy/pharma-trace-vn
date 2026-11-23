'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Form, Input, InputNumber, Modal, Select, Tag } from 'antd';
import { facilityService } from '@/services/facility.service';
import { productService } from '@/services/product.service';
import { warehouseService, type FactoryBatchSummary } from '@/services/warehouse.service';
import { MAX_PDF_LABELS, buildBatchLabelPdf, parseLabelCsv, type LabelBatch } from '@/utils/batch-label-pdf';
import { workflowErrorMessage } from '@/utils/workflow-error';

interface VariantOption { value: number; label: string; unit: string; name: string }

interface FormValues {
  facilityId?: number;
  variantId: number;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  boxCount: number;
  boxesPerCarton: number;
  certificateCoCq?: string;
}

/** Saves a CSV blob (box UIDs and SSCC codes) so the labels can be printed. */
export async function downloadBatchLabels(batchId: number, facilityId?: number) {
  const blob = await warehouseService.batchLabels(batchId, facilityId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `batch-${batchId}-labels.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Saves a printable PDF with the carton labels, the box QR labels and the secret-code labels of a batch.
 * Throws a readable Error when the batch is too large for the browser; use the CSV then.
 */
export async function downloadBatchLabelsPdf(batchId: number, batch: LabelBatch, facilityId?: number) {
  const rows = parseLabelCsv(await (await warehouseService.batchLabels(batchId, facilityId)).text());
  if (rows.length > MAX_PDF_LABELS) throw new Error(`This batch has ${rows.length} boxes. Use the CSV for batches above ${MAX_PDF_LABELS} boxes.`);
  const blob = await buildBatchLabelPdf(batch, rows, window.location.origin);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `batch-${batch.batchNumber}-labels.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  open: boolean;
  /** SUPER_ADMIN has no factory of its own and must pick one. */
  pickFactory: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function FactoryBatchModal({ open, pickFactory, onClose, onCreated }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [factories, setFactories] = useState<{ value: number; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const latestSearch = useRef(0);
  const chosen = useRef<VariantOption | undefined>(undefined);
  const [created, setCreated] = useState<{ batch: FactoryBatchSummary; facilityId?: number; label: LabelBatch }>();
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!pickFactory) return;
    facilityService.getDropdownList()
      .then(res => setFactories(res.data
        .filter(facility => String(facility.rawType ?? facility.type).toUpperCase() === 'FACTORY')
        .map(facility => ({ value: facility.id, label: facility.name }))))
      .catch(error => message.error(workflowErrorMessage(error, 'Unable to load factories')));
  }, [open, pickFactory, message]);

  // Show only the results of the latest search (plus the chosen one so its label stays visible);
  // keeping every earlier result would bury the match under the broad results of "p", "pa", ...
  const searchVariants = async (search: string) => {
    const ticket = ++latestSearch.current;
    if (!search.trim()) {
      setVariants(chosen.current ? [chosen.current] : []);
      return;
    }
    try {
      const res = await productService.getProducts({ search: search.trim(), limit: 20 });
      if (ticket !== latestSearch.current) return;
      const found = res.data.flatMap(product => (product.packagingOptions || [])
        .map(option => ({ value: option.id, label: `${option.unitName} · ${product.medicineName}`, unit: option.unitName, name: product.medicineName })));
      setVariants(chosen.current && !found.some(option => option.value === chosen.current?.value) ? [chosen.current, ...found] : found);
    } catch (error) {
      if (ticket === latestSearch.current) message.error(workflowErrorMessage(error, 'We could not search medicines.'));
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await warehouseService.createFactoryBatch({ ...values, certificateCoCq: values.certificateCoCq?.trim() || undefined });
      setCreated({ batch: res.data, facilityId: values.facilityId, label: { batchNumber: res.data.batchNumber, medicineName: chosen.current?.name ?? '', expiryDate: values.expiryDate } });
      message.success(`Batch ${res.data.batchNumber} created`);
      onCreated();
    } catch (error) {
      message.error(workflowErrorMessage(error, 'We could not create the batch.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New factory batch"
      onCancel={onClose}
      afterClose={() => { setCreated(undefined); form.resetFields(); }}
      destroyOnHidden
      footer={created
        ? <Button type="primary" onClick={onClose}>Done</Button>
        : [<Button key="cancel" onClick={onClose}>Cancel</Button>, <Button key="ok" type="primary" loading={saving} onClick={submit}>Create batch</Button>]}
    >
      {created ? (
        <div className="space-y-3">
          <Alert type="success" showIcon title={`${created.batch.boxCount} boxes in ${created.batch.cartonCount} cartons were registered and added to factory stock.`} />
          <div className="flex flex-wrap gap-2">
            <Button type="primary" loading={pdfBusy} onClick={() => {
              setPdfBusy(true);
              downloadBatchLabelsPdf(created.batch.id, created.label, created.facilityId)
                .catch(error => message.error(workflowErrorMessage(error, 'We could not build the label PDF.')))
                .finally(() => setPdfBusy(false));
            }}>
              Download labels (PDF)
            </Button>
            <Button onClick={() => downloadBatchLabels(created.batch.id, created.facilityId).catch(error => message.error(workflowErrorMessage(error, 'We could not download the labels.')))}>
              Download labels (CSV)
            </Button>
          </div>
          <p className="m-0 text-xs text-slate-500">The PDF has carton labels (SSCC QR), box labels (QR to scan) and the secret-code labels to print under the scratch layer. The CSV lists every box UID, its SSCC carton code and the secret code printed under the scratch layer. Treat it as confidential: anyone holding it can verify a box as authentic. You can download it again from the Labels column.</p>
        </div>
      ) : (
        <Form form={form} layout="vertical" requiredMark>
          {pickFactory && (
            <Form.Item name="facilityId" label="Factory" rules={[{ required: true, message: 'Choose a factory' }]}>
              <Select options={factories} placeholder="Select factory" />
            </Form.Item>
          )}
          <Form.Item name="variantId" label="Medicine and packaging" rules={[{ required: true, message: 'Choose a product packaging' }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={searchVariants}
              onChange={(value: number) => { chosen.current = variants.find(option => option.value === value); }}
              options={variants}
              optionRender={option => (
                <div className="flex items-center gap-2" title={option.label as string}>
                  <Tag color="blue" className="m-0 shrink-0">{option.data.unit}</Tag>
                  <span className="truncate">{option.data.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">#{option.value}</span>
                </div>
              )}
              placeholder="Type a medicine name to search"
              notFoundContent="No matching medicine. Ask an administrator to add the product and packaging first."
            />
          </Form.Item>
          <Form.Item name="batchNumber" label="Batch number" rules={[{ required: true, whitespace: true, message: 'Enter the batch number' }]}>
            <Input maxLength={100} placeholder="LOT-2026-001" />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="productionDate" label="Production date" rules={[{ required: true, message: 'Required' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item
              name="expiryDate"
              label="Expiry date"
              dependencies={['productionDate']}
              rules={[{ required: true, message: 'Required' }, ({ getFieldValue }) => ({
                validator: (_, value?: string) => !value || !getFieldValue('productionDate') || value > getFieldValue('productionDate')
                  ? Promise.resolve() : Promise.reject(new Error('Must be after the production date')),
              })]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item name="boxCount" label="Total boxes" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} precision={0} className="w-full" />
            </Form.Item>
            <Form.Item name="boxesPerCarton" label="Boxes per carton" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} precision={0} className="w-full" />
            </Form.Item>
          </div>
          <Form.Item name="certificateCoCq" label="CO/CQ certificate (optional)">
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
