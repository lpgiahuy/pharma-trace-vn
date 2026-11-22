'use client';

import React, { useEffect, useState } from 'react';
import { DatePicker, Select } from 'antd';
import dayjs from 'dayjs';
import { facilityService } from '@/services/facility.service';
import type { Facility } from '@/types/facility.types';
import { RANGE_PRESETS, presetRange, vietnamToday, type RangePreset } from '@/utils/report-format';

const { RangePicker } = DatePicker;

export interface DashboardRange {
  preset?: RangePreset;
  from: string;
  to: string;
  facilityId?: number;
}

interface DateRangeFilterProps {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  showFacility: boolean;
}

export function DateRangeFilter({ value, onChange, showFacility }: DateRangeFilterProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);

  useEffect(() => {
    if (!showFacility) return;
    facilityService
      .getDropdownList()
      .then(res => setFacilities(res.data.filter(f => f.type === 'PHARMACY')))
      .catch(() => setFacilities([]));
  }, [showFacility]);

  return (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <Select<RangePreset>
        value={value.preset}
        placeholder="Custom range"
        onChange={preset => onChange({ ...value, preset, ...presetRange(preset, vietnamToday()) })}
        options={RANGE_PRESETS}
        className="w-full sm:w-36"
      />
      <RangePicker
        value={[dayjs(value.from), dayjs(value.to)]}
        format="DD/MM/YYYY"
        allowClear={false}
        disabledDate={day => day.isAfter(dayjs(), 'day')}
        onChange={dates => {
          if (!dates?.[0] || !dates[1]) return;
          onChange({ ...value, preset: undefined, from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') });
        }}
        className="w-full sm:w-60"
      />
      {showFacility && (
        <Select<number | 'all'>
          value={value.facilityId ?? 'all'}
          onChange={id => onChange({ ...value, facilityId: id === 'all' ? undefined : id })}
          options={[{ value: 'all', label: 'All facilities' }, ...facilities.map(f => ({ value: f.id, label: f.name }))]}
          className="w-full sm:w-52"
        />
      )}
    </div>
  );
}
