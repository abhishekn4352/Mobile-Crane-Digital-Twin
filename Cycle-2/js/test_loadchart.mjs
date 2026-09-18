    import { CHART, ratedCapacity, validate, VALIDATION_CELLS } from './loadchart.js';

validate(CHART, VALIDATION_CELLS, 10);

console.log('\nNull boundary checks:');
console.log('  boom=13.3m, r=20 (null expected):', ratedCapacity(CHART, 13.3, 20));
console.log('  boom=70.0m, r=5  (null expected):', ratedCapacity(CHART, 70.0, 5));
console.log('  boom=99m  (out of range, null)  :', ratedCapacity(CHART, 99, 10));
