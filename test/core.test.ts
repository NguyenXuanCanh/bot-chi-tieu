import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, fallbackParse, formatVnd, normalizeCity, parseAmount, sameCity, vnDate } from '../src/core.ts';

test('parseAmount reads Vietnamese money formats', () => {
  assert.equal(parseAmount('45k'), 45_000);
  assert.equal(parseAmount('45 nghìn'), 45_000);
  assert.equal(parseAmount('1tr2'), 1_200_000);
  assert.equal(parseAmount('1.2tr'), 1_200_000);
  assert.equal(parseAmount('1,5 triệu'), 1_500_000);
  assert.equal(parseAmount('120.000'), 120_000);
  assert.equal(parseAmount('120000đ'), 120_000);
  assert.equal(parseAmount('2 củ'), 2_000_000);
  assert.equal(parseAmount('45'), null);
  assert.equal(parseAmount('phở'), null);
});

test('formatVnd', () => {
  assert.equal(formatVnd(45_000), '45k');
  assert.equal(formatVnd(1_250_000), '1,25tr');
  assert.equal(formatVnd(2_000_000), '2tr');
});

test('city names match regardless of accents and prefixes', () => {
  assert.equal(normalizeCity('TP. Hồ Chí Minh'), 'ho chi minh');
  assert.ok(sameCity('Sài Gòn', 'TP. Hồ Chí Minh'));
  assert.ok(sameCity('Đà Lạt', 'da lat'));
  assert.ok(!sameCity('Đà Lạt', 'Đà Nẵng'));
});

test('dates are Vietnam time', () => {
  // 2026-10-21 18:30 UTC = 2026-10-22 01:30 giờ VN
  const now = Date.UTC(2026, 9, 21, 18, 30);
  assert.equal(vnDate(now), '2026-10-22');
  assert.equal(vnDate(now, -1), '2026-10-21');
  assert.equal(daysBetween('2026-10-20', '2026-10-22'), 2);
});

test('fallback parser: items, location, yesterday', () => {
  const p = fallbackParse('hôm qua phở 45k, cafe 35k ở Đà Lạt');
  assert.equal(p.dayOffset, -1);
  assert.equal(p.city, 'Đà Lạt');
  assert.deepEqual(p.items.map((i) => [i.item, i.amount]), [['phở', 45_000], ['cafe', 35_000]]);
  const q = fallbackParse('@Hội An: cao lầu 50k');
  assert.equal(q.city, 'Hội An');
  assert.deepEqual(q.items.map((i) => [i.item, i.amount]), [['cao lầu', 50_000]]);
});

test('parseGoal reads savings goals', async () => {
  const { parseGoal, addMonths, monthsBetween } = await import('../src/core.ts');
  const today = '2026-10-22';
  assert.deepEqual(parseGoal('50tr tới tháng 2 năm sau để mua laptop', today), { target: 50_000_000, deadline: '2027-02', title: 'mua laptop' });
  assert.deepEqual(parseGoal('30tr sau 6 tháng', today), { target: 30_000_000, deadline: '2027-04', title: 'Tiết kiệm' });
  assert.equal(parseGoal('100 triệu 12/2027', today)?.deadline, '2027-12');
  assert.equal(parseGoal('tháng 2 năm 2027 để dành 20tr', today)?.target, 20_000_000);
  assert.equal(parseGoal('20tr tháng 3', today)?.deadline, '2027-03');
  assert.equal(parseGoal('20tr tháng 12', today)?.deadline, '2026-12');
  assert.equal(parseGoal('20tr cuối năm', today)?.deadline, '2026-12');
  assert.equal(parseGoal('20tr', today), null);
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(monthsBetween('2026-10', '2027-02'), 4);
});

test('reply edit helpers', async () => {
  const { matchCategory, matchDay } = await import('../src/core.ts');
  assert.equal(matchCategory('cafe'), 'Cà phê & đồ uống');
  assert.equal(matchCategory('đổi sang ăn uống'), 'Ăn uống');
  assert.equal(matchCategory('Di chuyển'), 'Di chuyển');
  assert.equal(matchCategory('đi lại'), 'Di chuyển');
  assert.equal(matchCategory('nạp game'), 'Nạp game');
  assert.equal(matchCategory('60k'), null);
  assert.equal(matchCategory('xóa'), null);
  assert.equal(matchDay('hôm qua', '2026-10-22'), '2026-10-21');
  assert.equal(matchDay('20/10', '2026-10-22'), '2026-10-20');
  assert.equal(matchDay('25/12', '2026-10-22'), '2025-12-25');
  assert.equal(matchDay('60k', '2026-10-22'), null);
});

test('matchCategory ignores day words', async () => {
  const { matchCategory } = await import('../src/core.ts');
  assert.equal(matchCategory('hôm qua'), null);
  assert.equal(matchCategory('quà'), 'Quà tặng');
  assert.equal(matchCategory('hôm qua cafe'), 'Cà phê & đồ uống');
});

test('matchPaylater', async () => {
  const { matchPaylater } = await import('../src/core.ts');
  assert.equal(matchPaylater('momo'), 'momo');
  assert.equal(matchPaylater('ZaloPay'), 'zalopay');
  assert.equal(matchPaylater('zalo'), 'zalopay');
  assert.equal(matchPaylater('Shopee'), 'spaylater');
  assert.equal(matchPaylater('spay'), 'spaylater');
  assert.equal(matchPaylater('thẻ'), 'card');
  assert.equal(matchPaylater('phở'), null);
});
