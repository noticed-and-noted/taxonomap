/** The map page's modes as the switches show them: label and icon, in the order they appear. */
import type { MapMode } from '~/stores/mode';

export interface ModeOption {
  value: MapMode;
  label: string;
  /** 24×24 stroke path. */
  icon: string;
}

export const MODE_OPTIONS: readonly ModeOption[] = [
  { value: 'explore', label: 'Explore', icon: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
  {
    value: 'near',
    label: 'Near me',
    icon: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  },
  { value: 'analyse', label: 'Analyse', icon: 'M4 4v16h16M8 15l3.5-4 3 2.5L20 7' },
];
