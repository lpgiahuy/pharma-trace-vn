'use client';

import React, { useEffect, useState } from 'react';
import { DatePicker, Select } from 'antd';
import dayjs from 'dayjs';
import { facilityService } from '@/services/facility.service';
import type { Facility } from '@/types/facility.types';
import { RANGE_PRESETS, presetRange, vietnamToday, type RangePreset } from '@/utils/report-format';

const { RangePicker } = DatePicker;
const DAY = 'YYYY-MM-DD';

export interface DashboardRange {
  preset: RangePreset | null;
  from: string;
  to: string;
  facilityId?: number;
}

export function initialDashboardRange(): DashboardRange {
  return { preset: 'last30', ...presetRange('last30', vietnamToday()) };
}

interface DateRangeFilterProps {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  /** Only SUPER_ADMIN / ADMIN pick a facility; store managers are scoped by the API. */
  showFacility: boolean;
}

export function DateRangeFilter({ value, onChange, showFacility }: DateRangeFilterProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);

  useEffect(() => {
    if (!showFacility) return;
    let cancelled = false;
    facilityService
      .getDropdownList()
      .then(res => {
        if (!cancelled) setFacilities((res.data ?? []).filter(f => String(f.type).toUpperCase() === 'PHARMACY'));
      })
      .catch(() => {
        if (!cancelled) setFacilities([]);
      });
    return () => { cancelled = true; };
  }, [showFacility]);

  const today = dayjs(vietnamToday());

  return (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <Select<RangePreset | 'custom'>
        value={value.preset ?? 'custom'}
        onChange={preset => {
          if (preset === 'custom') return;
          onChange({ ...value, preset, ...presetRange(preset, vietnamToday()) });
        }}
        options={[
          ...RANGE_PRESETS,
          { value: 'custom' as const, label: 'Custom range', disabled: true },
        ]}
        className="w-full sm:w-36"
        aria-label="Date range preset"
      />
      <RangePicker
        value={[dayjs(value.from), dayjs(value.to)]}
        format="DD/MM/YYYY"
        allowClear={false}
        disabledDate={current => current.isAfter(today, 'day')}
        onChange={dates => {
          const [start, end] = dates ?? [];
          if (!start || !end) return;
          onChange({ ...value, preset: null, from: start.format(DAY), to: end.format(DAY) });
        }}
        className="w-full sm:w-60"
      />
      {showFacility && (
        <Select<number | 'all'>
          value={value.facilityId ?? 'all'}
          onChange={id => onChange({ ...value, facilityId: id === 'all' ? undefined : id })}
          options={[
            { value: 'all' as const, label: 'All facilities' },
            ...facilities.map(f => ({ value: f.id, label: f.name })),
          ]}
          showSearch={{ optionFilterProp: 'label' }}
          className="w-full sm:w-52"
          aria-label="Facility"
        />
      )}
    </div>
  );
}
