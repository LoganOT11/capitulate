const { test, expect } = require('playwright/test');

async function waitForGameReady(page) {
  await page.waitForFunction(() => window.__gameReady === true);
}

async function waitUntilStopped(page) {
  // Wait until rolling finishes AND any shop/battle has closed (back to board state).
  await page.waitForFunction(() => {
    const state = window.__game && window.__game.getState();
    return state && state.rolling === false && state.gameState === 'board';
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForGameReady(page);
});

test('renders the board canvas and an enabled roll button', async ({ page }) => {
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await expect(page.getByTestId('position')).toHaveText('0');
});

test('a deterministic roll moves the token by the dice sum', async ({ page }) => {
  await page.evaluate(() => window.__game.rollWith(3, 4));
  await waitUntilStopped(page);

  const state = await page.evaluate(() => window.__game.getState());
  expect(state.dice).toEqual([3, 4]);
  expect(state.sum).toBe(7);
  expect(state.position).toBe(7);

  await expect(page.getByTestId('die-1')).toHaveText('3');
  await expect(page.getByTestId('die-2')).toHaveText('4');
  await expect(page.getByTestId('sum')).toHaveText('7');
  await expect(page.getByTestId('position')).toHaveText('7');
});

test('clicking the roll button rolls valid dice and advances the token', async ({ page }) => {
  await page.getByTestId('roll-button').click();
  await waitUntilStopped(page);

  const state = await page.evaluate(() => window.__game.getState());
  expect(state.dice[0]).toBeGreaterThanOrEqual(1);
  expect(state.dice[0]).toBeLessThanOrEqual(6);
  expect(state.dice[1]).toBeGreaterThanOrEqual(1);
  expect(state.dice[1]).toBeLessThanOrEqual(6);
  // Starting from GO (0), position equals the sum after a single roll.
  expect(state.position).toBe(state.sum);
});

test('the token wraps around the 40-tile board', async ({ page }) => {
  // 4 x 12 = 48 tiles of travel -> 48 % 40 = 8.
  // Movement passes through corner tiles which open shops/battles.
  // Close any shop that opens so movement can resume.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__game.rollWith(6, 6));
    // Wait for a shop to potentially open (tween per tile = 140ms).
    await page.waitForFunction(() => {
      const s = window.__game.getState();
      return s.gameState === 'shop' || (!s.rolling && s.gameState === 'board');
    }, { timeout: 5000 });
    await page.evaluate(() => {
      if (window.__game.getState().gameState === 'shop') {
        window.__game.closeShop();
      }
    });
    await waitUntilStopped(page);
  }
  const state = await page.evaluate(() => window.__game.getState());
  expect(state.position).toBe(8);
});

test('a roll is ignored while the token is still moving', async ({ page }) => {
  await page.evaluate(() => {
    window.__game.rollWith(2, 2); // starts moving
    window.__game.rollWith(6, 6); // should be ignored mid-move
  });
  await waitUntilStopped(page);

  const state = await page.evaluate(() => window.__game.getState());
  expect(state.dice).toEqual([2, 2]);
  expect(state.position).toBe(4);
});
