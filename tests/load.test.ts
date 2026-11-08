import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture } from './fixture.ts'
import { parseDataset } from '../packages/domain/load.ts'
import { read } from '../packages/domain/model.ts'

test('imports unknown topology and sorts observations by sensor time', () => {
  const sample = fixture()
  const data = parseDataset('field test', sample.network, sample.ops, sample.csv)
  assert.equal(data.systems[0].id, 'new/region')
  assert.equal(data.facilities.size, 3)
  assert.equal(data.assets.size, 17)
  assert.equal(data.now - data.start, 15 * 60)
  assert.equal(read(data, 'A/well', 'water_bpd', data.now), 1440)
  assert.equal(read(data, 'A/well', 'water_bpd', data.now + 300), undefined)
  assert.equal(data.facilities.get('A')!.wells[0].revenuePerHour, 300)
})

test('rejects malformed input and duplicate sensor rows', () => {
  const sample = fixture()
  assert.throws(() => parseDataset('bad', '{}', sample.ops, sample.csv), /defaults/)
  assert.throws(() => parseDataset('bad', sample.network, sample.ops, sample.csv + '\n' + sample.csv.split('\n')[1]), /duplicate reading/)
  assert.throws(() => parseDataset('bad', sample.network, sample.ops, sample.csv.replace('A/well,water_bpd', 'unknown,water_bpd')), /invalid timestamp, value, asset or sensor/)
})
