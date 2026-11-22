import { Injectable } from '@nestjs/common';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

export interface FraudRadarAlert {
  id: number;
  uid: string | null;
  fraudType: string;
  severity: string | null;
  description: string | null;
  fromLatitude: number | null;
  fromLongitude: number | null;
  toLatitude: number | null;
  toLongitude: number | null;
  distanceKm: number | null;
  minutes: number | null;
  speedKmh: number | null;
  resolutionStatus: string | null;
  createdAt: Date | null;
}

export interface FraudReport {
  scans24h: number;
  suspicious24h: number;
  openAlerts: number;
  criticalAlerts: number;
  alerts: FraudRadarAlert[];
}

@Injectable()
export class FraudService {
  constructor(private readonly prisma: PrismaService) {}

  report(user: CurrentUserPayload): Promise<FraudReport> {
    return this.prisma.withTraceability(authActor(user), async tx => {
      const [[scans], [open], alerts] = await Promise.all([
        tx.$queryRaw<Pick<FraudReport, 'scans24h' | 'suspicious24h'>[]>`
          SELECT scans_24h AS "scans24h", suspicious_24h AS "suspicious24h" FROM public.fraud_scan_stats()`,
        tx.$queryRaw<Pick<FraudReport, 'openAlerts' | 'criticalAlerts'>[]>`
          SELECT (count(*) FILTER (WHERE resolution_status = 'UNRESOLVED'))::integer AS "openAlerts",
            (count(*) FILTER (WHERE resolution_status = 'UNRESOLVED' AND severity_level = 'CRITICAL'))::integer AS "criticalAlerts"
          FROM public.fraud_alerts`,
        tx.$queryRaw<FraudRadarAlert[]>`
          SELECT a.id, a.uid::text AS uid, a.fraud_type AS "fraudType", a.severity_level AS severity, a.description,
            a.latitude_1::float8 AS "fromLatitude", a.longitude_1::float8 AS "fromLongitude",
            a.latitude_2::float8 AS "toLatitude", a.longitude_2::float8 AS "toLongitude",
            a.distance_km AS "distanceKm", a.time_delta_minutes AS minutes, a.calculated_speed_kmh AS "speedKmh",
            a.resolution_status AS "resolutionStatus", a.created_at AS "createdAt"
          FROM public.fraud_alerts a
          ORDER BY (a.resolution_status = 'UNRESOLVED') DESC, a.id DESC LIMIT 50`,
      ]);
      return { ...scans, ...open, alerts };
    });
  }
}
