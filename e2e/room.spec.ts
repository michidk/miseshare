import { expect, test } from '@playwright/test';

test('two participants can join and exchange a chat message', async ({ browser, page }) => {
  await page.goto('/');
  await page.locator('#share-button').click();
  await expect(page.locator('#room')).toBeVisible();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('#room')).toBeVisible();
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator('[data-participant-count]').first()).toContainText('2 participants', { timeout: 20_000 });

  await viewer.locator('[data-chat-input]').fill('hello from the browser test');
  await viewer.locator('[data-chat-input]').press('Enter');
  await expect(page.locator('[data-chat-messages]')).toContainText('hello from the browser test', { timeout: 10_000 });
  await expect(page.locator('#notification-toaster')).toContainText('hello from the browser test');
  await viewerContext.close();
});

test('a participant can accept and download a peer-to-peer file drop', async ({ browser, page }) => {
  await page.goto('/');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(page.locator('#drop-button')).toBeDisabled();

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });

  const secondViewerContext = await browser.newContext();
  const secondViewer = await secondViewerContext.newPage();
  await secondViewer.goto(page.url());
  await expect(secondViewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });

  await expect(page.locator('#drop-button')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#drop-button').click();
  await expect(page.locator('#drop-peer-count')).toHaveText('2 connected peers', { timeout: 20_000 });
  await page.locator('#drop-file-input').setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello over WebRTC'),
  });

  await expect(page.locator('.drop-transfer')).toHaveCount(1);
  await expect(page.locator('.drop-transfer')).toContainText('To 2 recipients');
  const viewerRequest = viewer.locator('[data-chat-file-request]');
  const secondViewerRequest = secondViewer.locator('[data-chat-file-request]');
  await expect(viewerRequest).toContainText('hello.txt');
  await expect(secondViewerRequest).toContainText('hello.txt');
  await viewerRequest.locator('.chat-file-accept').click();
  await secondViewerRequest.locator('.chat-file-accept').click();
  const downloadLink = viewerRequest.locator('.chat-file-download');
  await expect(downloadLink).toBeVisible({ timeout: 20_000 });
  await expect(secondViewerRequest.locator('.chat-file-download')).toBeVisible({ timeout: 20_000 });
  const downloadPromise = viewer.waitForEvent('download');
  await downloadLink.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(download.suggestedFilename()).toBe('hello.txt');
  expect(Buffer.concat(chunks).toString()).toBe('hello over WebRTC');
  await expect(page.locator('.drop-transfer')).toContainText('Sent to 2 recipients');
  await secondViewerContext.close();
  await viewerContext.close();
});

test('lossless text mode renders a multi-chunk frame pixel-exactly', async ({ browser, page }) => {
  await page.goto('/');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });

  await page.locator('#quality-button').click();
  await page.locator('[data-quality="text"]').click();
  await expect(page.locator('#quality-label')).toHaveText('Text');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    const image = context.createImageData(canvas.width, canvas.height);
    for (let offset = 0; offset < image.data.length; offset += 65_536) {
      crypto.getRandomValues(image.data.subarray(offset, Math.min(image.data.length, offset + 65_536)));
    }
    for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255;
    context.putImageData(image, 0, 0);
    const stream = canvas.captureStream(6);
    const mediaDevices = navigator.mediaDevices ?? {};
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => stream });
    (window as unknown as { textTestStream: MediaStream }).textTestStream = stream;
  });

  await page.locator('#stream-button').click();
  const remoteCard = viewer.locator('.stream-card');
  const remoteCanvas = remoteCard.locator('canvas');
  await expect(remoteCard).not.toHaveClass(/connecting/, { timeout: 30_000 });
  await expect(remoteCanvas).toHaveJSProperty('width', 1280);
  await expect(remoteCanvas).toHaveJSProperty('height', 720);
  await expect(remoteCard.locator('.stream-person small')).toHaveText('Native resolution (1280 × 720) · 6 fps · lossless');

  const publisherHash = await pixelHash(page.locator('.stream-card video'));
  const viewerHash = await pixelHash(remoteCanvas);
  expect(viewerHash).toBe(publisherHash);
  await viewerContext.close();
});

test('a same-context tab joining after native sharing started receives the stream', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(page.locator('#test-stream-button')).toBeVisible();
  await page.locator('#test-stream-button').click();
  await expect(page.locator('.stream-card')).not.toHaveClass(/connecting/);

  const viewer = await page.context().newPage();
  await viewer.goto(page.url());
  const remoteCard = viewer.locator('.stream-card');
  await expect(remoteCard).not.toHaveClass(/connecting/, { timeout: 30_000 });
  await expectNativeVideoFrame(remoteCard.locator('video'));
  await viewer.close();
});

test('an existing same-context tab receives a native stream started by the host', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewer = await page.context().newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });

  await page.locator('#test-stream-button').click();
  const remoteCard = viewer.locator('.stream-card');
  await expect(remoteCard).not.toHaveClass(/connecting/, { timeout: 30_000 });
  await expectNativeVideoFrame(remoteCard.locator('video'));
  await viewer.close();
});

test('stream audio can be started, stopped, and resumed during a screen share', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);
  const viewer = await page.context().newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#test-stream-button').click();
  await expect(page.locator('#local-audio-button')).toHaveText('Start audio');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('No audio');

  await page.evaluate(() => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const canvas = document.createElement('canvas');
    const videoTrack = canvas.captureStream(1).getVideoTracks()[0];
    const audioTrack = destination.stream.getAudioTracks()[0];
    const mediaDevices = navigator.mediaDevices ?? {};
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const state = window as unknown as { audioPickerCalls?: number };
        state.audioPickerCalls = (state.audioPickerCalls ?? 0) + 1;
        return new MediaStream([videoTrack, audioTrack]);
      },
    });
  });

  await page.locator('#local-audio-button').click();
  await expect(page.locator('#local-audio-button')).toHaveText('Stop audio');
  await expect(page.locator('#your-stream-status')).toContainText('audio on');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Audio on');
  await page.locator('#local-audio-button').click();
  await expect(page.locator('#local-audio-button')).toHaveText('Resume audio');
  await expect(page.locator('#your-stream-status')).toContainText('audio off');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('No audio');
  await page.locator('#local-audio-button').click();
  await expect(page.locator('#local-audio-button')).toHaveText('Stop audio');
  await expect(page.locator('#your-stream-status')).toContainText('audio on');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Audio on');
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioPickerCalls?: number }).audioPickerCalls)).toBe(1);
  await viewer.close();
});

test('voice-only microphone and screen audio can be shared and stopped independently', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);
  const viewer = await page.context().newPage();
  await viewer.goto(page.url());
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator('#local-microphone-button')).toBeVisible();
  await expect(page.locator('#local-microphone-button')).toHaveAttribute('title', 'Share microphone');

  await page.evaluate(() => {
    const microphoneContext = new AudioContext();
    const microphoneOscillator = microphoneContext.createOscillator();
    const microphoneDestination = microphoneContext.createMediaStreamDestination();
    microphoneOscillator.connect(microphoneDestination);
    microphoneOscillator.start();

    const mediaDevices = navigator.mediaDevices ?? {};
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const state = window as unknown as { microphoneConstraints?: MediaStreamConstraints; microphonePickerCalls?: number; microphoneTrack?: MediaStreamTrack };
        state.microphoneConstraints = constraints;
        state.microphonePickerCalls = (state.microphonePickerCalls ?? 0) + 1;
        state.microphoneTrack = microphoneDestination.stream.getAudioTracks()[0];
        return new MediaStream([state.microphoneTrack]);
      },
    });
    Object.defineProperty(mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const screenContext = new AudioContext();
        const screenOscillator = screenContext.createOscillator();
        const screenDestination = screenContext.createMediaStreamDestination();
        screenOscillator.connect(screenDestination);
        screenOscillator.start();
        void screenContext.resume().catch(() => {});
        const canvas = document.createElement('canvas');
        const videoTrack = canvas.captureStream(1).getVideoTracks()[0];
        const stream = new MediaStream([videoTrack, screenDestination.stream.getAudioTracks()[0]]);
        const state = window as unknown as { screenAudioCaptures?: Array<{ context: AudioContext; oscillator: OscillatorNode; stream: MediaStream }> };
        state.screenAudioCaptures = [...(state.screenAudioCaptures ?? []), { context: screenContext, oscillator: screenOscillator, stream }];
        return stream;
      },
    });
  });

  await page.locator('#local-microphone-button').click();
  await expect(page.locator('#local-microphone-button')).toHaveAttribute('title', 'Stop sharing microphone');
  await expect(page.locator('#your-stream-status')).toHaveText('Voice only · mic on');
  const localVoiceCard = page.locator('.stream-card.voice-only');
  const remoteVoiceCard = viewer.locator('.stream-card.voice-only');
  await expect(localVoiceCard).not.toHaveClass(/connecting/);
  await expect(remoteVoiceCard).not.toHaveClass(/connecting/, { timeout: 20_000 });
  await expect(remoteVoiceCard.locator('.voice-avatar-stage')).toBeVisible();
  await expect(remoteVoiceCard.locator('.voice-avatar')).toHaveText('👑');
  await expect(remoteVoiceCard.locator('.stream-person small')).toHaveText('Voice transmission · microphone on');
  await expect(remoteVoiceCard.locator('.audio-state')).toHaveText('Voice on');
  await page.locator('#test-stream-button').click();
  await expect(page.locator('.stream-card')).not.toHaveClass(/voice-only/);
  await expect(viewer.locator('.stream-card')).not.toHaveClass(/voice-only/);
  await expect(page.locator('#your-stream-status')).toContainText('mic on');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Audio on');

  await page.locator('#local-audio-button').click();
  await expect(page.locator('#your-stream-status')).toContainText('audio + mic on');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Audio on');
  await page.locator('#local-audio-button').click();
  await expect(page.locator('#your-stream-status')).toContainText('mic on');
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Audio on');

  await page.locator('#stream-button').click();
  await expect(viewer.locator('.stream-card.voice-only')).not.toHaveClass(/connecting/);
  await expect(viewer.locator('.stream-card .audio-state')).toHaveText('Voice on');
  await expect(page.locator('#local-microphone-button')).toBeVisible();
  await expect(page.locator('#local-microphone-button')).toHaveAttribute('title', 'Stop sharing microphone');
  await expect(page.locator('#your-stream-status')).toHaveText('Voice only · mic on');
  await page.locator('#local-microphone-button').click();
  await expect(page.locator('#local-microphone-button')).toHaveAttribute('title', 'Share microphone');
  await expect(page.locator('#your-stream-status')).toHaveText('Not sharing');
  await expect(viewer.locator('.stream-card')).toHaveCount(0);
  const microphoneCapture = await page.evaluate(() => {
    const state = window as unknown as { microphoneConstraints?: MediaStreamConstraints; microphonePickerCalls?: number; microphoneTrack?: MediaStreamTrack };
    return { calls: state.microphonePickerCalls, constraints: state.microphoneConstraints, trackState: state.microphoneTrack?.readyState };
  });
  expect(microphoneCapture.calls).toBe(1);
  expect(microphoneCapture.trackState).toBe('ended');
  expect(microphoneCapture.constraints).toEqual({
    audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
    video: false,
  });

  await viewer.evaluate(() => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => new MediaStream([destination.stream.getAudioTracks()[0]]),
    });
  });
  await viewer.locator('#local-microphone-button').click();
  const guestVoiceCard = page.locator('.stream-card.voice-only');
  await expect(guestVoiceCard).not.toHaveClass(/connecting/, { timeout: 20_000 });
  await expect(guestVoiceCard.locator('.voice-avatar')).toHaveText(/\S/);
  await expect(guestVoiceCard.locator('.audio-state')).toHaveText('Voice on');
  await viewer.locator('#local-microphone-button').click();
  await expect(page.locator('.stream-card')).toHaveCount(0);
  await viewer.close();
});

test('microphone permission denial explains how to enable access', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(page.locator('#local-microphone-button')).toBeEnabled();

  await page.evaluate(() => {
    const mediaDevices = navigator.mediaDevices ?? {};
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    });
  });

  await page.locator('#local-microphone-button').click();
  await expect(page.locator('#toast')).toContainText(
    'Microphone access was blocked. Allow microphone access in your browser settings and try again.',
  );
  await expect(page.locator('#local-microphone-button')).toHaveAttribute('title', 'Share microphone');
});

test('the host receives a native stream started by an existing same-context tab', async ({ page }) => {
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const viewer = await page.context().newPage();
  await viewer.goto(`${page.url()}?test`);
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await expect(viewer.locator('#test-stream-button')).toBeEnabled();

  await viewer.locator('#test-stream-button').click();
  const remoteCard = page.locator('.stream-card');
  await expect(remoteCard).not.toHaveClass(/connecting/, { timeout: 30_000 });
  await expectNativeVideoFrame(remoteCard.locator('video'));
  await viewer.close();
});

test('an opener-cloned tab receives repeated host and participant streams', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?test');
  await page.locator('#share-button').click();
  await expect(page).toHaveURL(/\/room\/[a-z2-9]{4}-[a-z2-9]{4}$/);

  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(() => window.open(`${location.href}?test`, '_blank'));
  const viewer = await popupPromise;
  await expect(viewer.locator('[data-chat-input]')).toBeEnabled({ timeout: 20_000 });
  await installVisibleDisplayMedia(page);
  await installVisibleDisplayMedia(viewer);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.bringToFront();
    await page.locator('#stream-button').click();
    await expect(viewer.locator('.stream-card video')).toHaveJSProperty('videoWidth', 1280, { timeout: 30_000 });
    await expect(viewer.locator('.stream-card video')).toHaveJSProperty('muted', true);
    await expect.poll(() => visibleVideoPixel(viewer.locator('.stream-card video')), { timeout: 30_000 }).toBe(true);
    await expect(viewer.locator('.stream-card')).not.toHaveClass(/connecting/, { timeout: 30_000 });
    await page.locator('#stream-button').click();
    await expect(viewer.locator('.stream-card')).toHaveCount(0);

    await viewer.bringToFront();
    await viewer.locator('#stream-button').click();
    await expect(page.locator('.stream-card video')).toHaveJSProperty('videoWidth', 1280, { timeout: 30_000 });
    await expect(page.locator('.stream-card video')).toHaveJSProperty('muted', true);
    await expect.poll(() => visibleVideoPixel(page.locator('.stream-card video')), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('.stream-card')).not.toHaveClass(/connecting/, { timeout: 30_000 });
    await viewer.locator('#stream-button').click();
    await expect(page.locator('.stream-card')).toHaveCount(0);
  }
  await viewer.close();
});

test('landing page does not overflow a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#landing')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

async function pixelHash(locator: import('@playwright/test').Locator) {
  return locator.evaluate((source: HTMLCanvasElement | HTMLVideoElement) => {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    return btoa(String.fromCharCode(...pixels));
  });
}

async function visibleVideoPixel(locator: import('@playwright/test').Locator) {
  return locator.evaluate((video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return false;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.drawImage(video, video.videoWidth / 2, video.videoHeight / 2, 1, 1, 0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return red + green + blue > 60;
  });
}

async function expectNativeVideoFrame(locator: import('@playwright/test').Locator) {
  await expect.poll(() => locator.evaluate((video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return false;
    return Math.abs(video.videoWidth / video.videoHeight - 16 / 9) < 0.01;
  })).toBe(true);
}

async function installVisibleDisplayMedia(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const mediaDevices = navigator.mediaDevices ?? {};
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is unavailable.');
        let frame = 0;
        const draw = () => {
          context.fillStyle = `hsl(${frame++ % 360} 72% 48%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = 'white';
          context.fillRect(540, 310, 200, 100);
        };
        draw();
        window.setInterval(draw, 50);
        return canvas.captureStream(20);
      },
    });
  });
}
