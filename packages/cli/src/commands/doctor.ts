import { doctor, formatDoctorReport } from '@minimalgallery/pipeline/doctor';
import { parse } from '../args.ts';
import { requireGalleryRoot } from '../root.ts';

export const DOCTOR_USAGE = `Usage: minimalgallery doctor

Reports photo and file counts, the projected deploy size against the
hosting limits, and anything that needs attention. Changes nothing.`;

export async function doctorCommand(args: string[], dir?: string) {
  parse(args, {}, DOCTOR_USAGE);
  const root = await requireGalleryRoot(dir);
  console.log(formatDoctorReport(await doctor(root)));
  return 0;
}
