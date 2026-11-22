'use client';

import React, { useState } from 'react';
import { Alert, App, Form, Input, InputNumber, Modal, Select } from 'antd';
import { reportService } from '@/services/report.service';
import type { PayableDetail, PaymentMethod } from '@/types/report.types';
import { PAYMENT_METHODS } from '@/utils/finance-report';
import { formatVnd } from '@/utils/report-format';
import { workflowErrorMessage } from '@/utils/workflow-error';

interface RecordPaymentModalProps {
  payable: PayableDetail & { payableId: number };
  onClose: () => void;
  onRecorded: () => void;
}

interface PaymentFormValues {
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string;
}

export function RecordPaymentModal({ payable, onClose, onRecorded }: RecordPaymentModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PaymentFormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: PaymentFormValues) => {
    setSaving(true);
    setError(null);
    try {
      await reportService.recordPayablePayment(payable.payableId, { ...values, reference: values.reference.trim() });
      message.success('Payment recorded');
      onRecorded();
    } catch (err) {
      setError(workflowErrorMessage(err, 'Could not record the payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Record payment" okText="Record payment" confirmLoading={saving} onOk={() => form.submit()} onCancel={onClose}>
      <p className="text-xs text-slate-500 mt-0 mb-4">
        {payable.supplierName}{payable.poCode ? ` · ${payable.poCode}` : ''} · Remaining {formatVnd(payable.amount)}
      </p>
      {error && <Alert type="error" showIcon message={error} className="mb-4" />}
      <Form<PaymentFormValues>
        form={form}
        layout="vertical"
        initialValues={{ amount: payable.amount, paymentMethod: 'BANK_TRANSFER' }}
        onFinish={values => void submit(values)}
      >
        <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter the amount' }]}>
          <InputNumber min={0.01} max={payable.amount} precision={2} addonAfter="₫" className="w-full" />
        </Form.Item>
        <Form.Item name="paymentMethod" label="Payment method" rules={[{ required: true }]}>
          <Select options={PAYMENT_METHODS.map(item => ({ value: item.value, label: item.label }))} />
        </Form.Item>
        <Form.Item name="reference" label="Reference" rules={[{ required: true, whitespace: true, max: 100, message: 'Enter a reference of up to 100 characters' }]}>
          <Input placeholder="Bank transaction or receipt number" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
