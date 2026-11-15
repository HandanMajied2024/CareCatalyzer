import type { CallStatus, PatientRecord } from '../types/careconnect.ts';

/** Ending the transport must never overwrite an outcome already recorded by classification. */
export function finishPatientCall(
  patient: PatientRecord,
  previousStatus: CallStatus = 'Pending Call',
): PatientRecord {
  return {
    ...patient,
    callStatus: patient.callStatus === 'Calling Live'
      ? previousStatus === 'Calling Live' ? 'Pending Call' : previousStatus
      : patient.callStatus,
    lastUpdatedAt: new Date().toLocaleTimeString('en-GB'),
  };
}
