import { strict as assert } from 'node:assert'
import { formatUsdc, parseUsdcInput, usdcDecimalError } from '../src/utils/format'

for (const [input, expected] of [
  ['0.60', 600000n], ['0.40', 400000n], ['0.000001', 1n],
  ['1.', 1000000n], ['.5', 500000n],
  ['9007199254740993', 9007199254740993000000n],
] as const) assert.equal(parseUsdcInput(input), expected, input)

for (const input of ['1.0000009', '-1', '1e6', '+1', '0', '', '.', '1.2.3'])
  assert.equal(parseUsdcInput(input), null, input)

assert.equal(usdcDecimalError('1.0000009'), 'Use up to 6 decimal places.')
assert.equal(usdcDecimalError('1.000001'), null)
assert.equal(formatUsdc(0n), '0.00')
assert.equal(formatUsdc(1250000000n), '1,250.00')
assert.equal(formatUsdc(9007199254740993000000n), '9,007,199,254,740,993.00')
assert.equal(formatUsdc(-1250000000n), '-1,250.00')
console.log('20 amount parsing and display checks passed.')
