import type { Catalog, Evidence, Product, RequirementResult } from './domain.js';

export type ContinuousPower = { watts?: number; temperatureC?: number; reason: string; evidence?: Evidence };
export function continuousPower(catalog: Catalog, product: Product, requirements: RequirementResult): ContinuousPower {
  const profile = product.continuousPowerProfile;
  if (!profile) return { reason: '没有附工况与来源的额定连续功率曲线。' };
  const evidence = { sourceId: profile.sourceId, quote: profile.quote, page: profile.page };
  if (!catalog.sources.some(s => s.id === profile.sourceId)) return { reason: '连续功率曲线缺少可追溯来源。' };
  const one = (field: string) => requirements.constraints.filter(c => c.field === field);
  const temperatures = one('temperature_c');
  if (temperatures.length !== 1 || !['eq', 'range'].includes(temperatures[0].operator)) return { reason: '需要明确的环境温度或完整温度范围。', evidence };
  const temperature = temperatures[0];
  const low = temperature.operator === 'range' ? temperature.min! : temperature.value!;
  const high = temperature.operator === 'range' ? temperature.max! : temperature.value!;
  const inputs = one('input_voltage_v');
  if (inputs.length !== 1 || inputs[0].operator !== 'range' || inputs[0].min! < profile.inputMinV || inputs[0].max! > profile.inputMaxV) return { reason: `连续曲线仅适用于${profile.inputMinV}–${profile.inputMaxV}VAC；本次输入工况未完整覆盖。`, evidence, temperatureC: high };
  const inputTypes = one('input_type');
  if (inputTypes.length !== 1 || inputTypes[0].textValue?.toUpperCase() !== 'AC') return { reason: '连续曲线只校验明确的交流输入工况。', evidence, temperatureC: high };
  const orientations = one('orientation');
  const normalized = (value: string) => ({ '垂直': 'vertical', '竖直': 'vertical', '垂直且输入端子朝下':'vertical-input-terminals-bottom' }[value] ?? value.toLowerCase());
  const suppliedOrientation = normalized(orientations[0]?.textValue ?? '');
  const orientationMatches = suppliedOrientation === normalized(profile.orientation) || (profile.orientation === 'vertical' && suppliedOrientation === 'vertical-input-terminals-bottom');
  if (orientations.length !== 1 || !orientationMatches) return { reason: '安装姿态没有证明符合连续曲线条件。', evidence, temperatureC: high };
  const altitude = one('altitude_m');
  if (altitude.length !== 1 || altitude[0].operator !== 'eq' || altitude[0].value! > profile.maxAltitudeM) return { reason: `需要明确海拔，且不高于${profile.maxAltitudeM}m。`, evidence, temperatureC: high };
  for (const [field, needed] of Object.entries({ top_clearance_mm: profile.clearancesMm.top, bottom_clearance_mm: profile.clearancesMm.bottom, side_clearance_mm: profile.clearancesMm.side })) {
    const values = one(field);
    if (values.length !== 1 || values[0].operator !== 'eq' || values[0].value! < needed) return { reason: `安装间距未证明满足厂家要求：${field}至少${needed}mm。`, evidence, temperatureC: high };
  }
  if (low < profile.points[0].temperatureC || high > profile.points.at(-1)!.temperatureC) return { reason: '环境温度超出已有连续功率曲线，不能外推。', evidence, temperatureC: high };
  const interpolate = (t: number) => {
    const index = profile.points.findIndex(p => p.temperatureC >= t);
    if (index === 0 || profile.points[index].temperatureC === t) return profile.points[index].powerW;
    const a = profile.points[index - 1], b = profile.points[index];
    return a.powerW + (b.powerW - a.powerW) * (t - a.temperatureC) / (b.temperatureC - a.temperatureC);
  };
  const temperaturesToCheck = [low, high, ...profile.points.filter(p => p.temperatureC > low && p.temperatureC < high).map(p => p.temperatureC)];
  const watts = Math.round(Math.min(...temperaturesToCheck.map(interpolate)) * 1e9) / 1e9;
  return { watts, temperatureC: high, evidence, reason: `按厂家额定连续曲线与安装条件，在${low === high ? high : `${low}–${high}`}℃核验${watts}W。峰值与PowerBoost另列。` };
}
