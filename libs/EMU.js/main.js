/*
 *
 *	Main Module
 *
 */

const volume0 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAdlJREFUaEPtV/8tREEQ/q4CVEAJOqADVIAKjgpQASpAB3RAB3RwOqAC8iUzyeblxM7NzG5esvPPJZd9+74fM9/uW2DmtZg5fgwCvR0cDgwHnAqMFnIK6H58OOCW0LlBhANnAB4A3AG4AfDlxGR6PILAT/HGFYBLAM8mFI7F0QQUCgmct3AjiwCJsJUuADw5BP730WgCBHs6eeuruMH2Cq9oAtzvEMAjgN0CLd3QIQ8lkUGAALelfa4maN/FDf6GVBYBBbcvyh9M0IZFbjYBxc1hvgawNYlcJhVnZONqRYAA98SNowlaV+S2JKC4j2XISzc45HTDfAD2IKBDzpZaroncE8sB2IuA4l4XuTxLeL+qqp4EGLWMWQ54WbwQ0p2q6kWAyvMGy8HW+hbgjNjqak2AqhM4B7msF3HCfN1oSYB9fSundKk6/zenj27QggDbhKqzbcq6l5ZxfQBlE9CoZOtofUrKuE7gbAd4B6Lq/N04YWomOdqBnT+i8UNUD7uFZjnAFHFHY43yWQTKd7+J6uZo7E2AB5IrGlsToML6+ch7DK8GrmhsTYBJQ9D8Dg6JxtYELO8LXxsRo+GgLBsOAha1MtYOBzJUtew5HLColbF2OJChqmXP2TvwC9QnXDG09TYhAAAAAElFTkSuQmCC';
const volume1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAT9JREFUaEPtmOFNwzAQhb9OAEwAm5ROUNiADWgnADZoN+gGwATAJrBBOwHoVCOlrR2fdVJQxLtfTXNn+957sZM3YeQxGfn6UQN/zaAYEANBBCShIIDh8n/FwDnwANwB9jsXn8ATsCncXwD3wFXh/jbVLr3UtDCwSpN7xr4FXo4Sb4BnTzGwBqzZarQ0YOicVUfcJ7wCtuBuWENzZ73NdeHJbWnguzNgru4aeEs5H4Bdd+MdmKY/ZoBdH0dtjpMCNdCBRAwAklDfg19DRxKShCoHhySkgywjEZ3EOokPZVHbKPQy94uAXqf1PZC0oG1U26i2UY93sc8Z0lbZ9ZhnBytueYhHb2yZnfiYrMWSwfWVcvqsRXPcLgvEG/JW63LlbIwWBvxiGzBTDQwIdnYqMSAGgghIQkEAw+ViIAxhcIAf7FugMSVj+F8AAAAASUVORK5CYII=';
let cxScreen = 512, cyScreen = 512, canvasRotation = 0;
const ctx = canvas.getContext('2d');

(window.onresize = () => {
	const zoom = Math.max(1, Math.min(Math.floor(window.innerWidth / cxScreen), Math.floor(window.innerHeight / cyScreen)));
	canvas.style.width = cxScreen * zoom + 'px';
	canvas.style.height = cyScreen * zoom + 'px';
	canvas.style.cssText += "position: absolute;"
	canvas.style.cssText += "left: 50%; top: 50%;"
	canvas.style.cssText += "transform:translate(-50%, -50%) rotate("+canvasRotation+"deg);"
	canvas.style.cssText += "image-rendering: pixelated;"
	canvas.style.cssText += "box-shadow: 1px 1px 5px #00000070;"
	canvas.style.cssText += "border-radius: 2px;"
  
})();

export function init({game, sound, keydown, keyup} = {}) {
	
	
	let {cxScreen, cyScreen, rotate} = game, images = [], silence, samples0, maxLength, source, node;
	
	canvas.width  = cxScreen
	canvas.height = cyScreen
	canvasRotation = rotate*90
	
	window.onresize()
	
	let lastFrame = {timestamp: 0, array: new Uint8ClampedArray(new Int32Array(cxScreen * cyScreen).fill(0xff000000).buffer), cxScreen, cyScreen};
	
	node = audioCtx.createScriptProcessor(2048, 1, 1), samples0 = silence = new Float32Array(maxLength = node.bufferSize);
	node.onaudioprocess = ({playbackTime, outputBuffer}) => {
		const buffer = outputBuffer.getChannelData(0);
		buffer.set(samples0), samples0 !== silence && (samples0 = silence, postMessage({timestamp: playbackTime + maxLength / audioCtx.sampleRate}, '*'));
	};
	
	const button = new Image();
	document.body.appendChild(button);
	button.addEventListener('click', () => { audioCtx.state === 'suspended' ? audioCtx.resume().catch() : audioCtx.state === 'running' && audioCtx.suspend().catch(); });
	
	
	document.addEventListener('keydown', keydown ? keydown : e => {
		if (e.repeat)
			return;
		switch (e.code) {
		case 'ArrowLeft':
			return void('left' in game && game.left(true));
		case 'ArrowUp':
			return void('up' in game && game.up(true));
		case 'ArrowRight':
			return void('right' in game && game.right(true));
		case 'ArrowDown':
			return void('down' in game && game.down(true));
		case 'Digit0':
			return void('coin' in game && game.coin(true));
		case 'Digit1':
			return void('start1P' in game && game.start1P(true));
		case 'Digit2':
			return void('start2P' in game && game.start2P(true));
		case 'KeyM': // MUTE
			return void(audioCtx.state === 'suspended' ? audioCtx.resume().catch() : audioCtx.state === 'running' && audioCtx.suspend().catch());
		case 'KeyR':
			return game.reset();
		case 'KeyT':
			return void('fTest' in game && (game.fTest = !game.fTest) === true && (game.fReset = true));
		case 'Space':
		case 'KeyX':
			return void('triggerA' in game && game.triggerA(true));
		case 'KeyZ':
			return void('triggerB' in game && game.triggerB(true));
		}
	});
	document.addEventListener('keyup', keyup ? keyup : e => {
		switch (e.code) {
		case 'ArrowLeft':
			return void('left' in game && game.left(false));
		case 'ArrowUp':
			return void('up' in game && game.up(false));
		case 'ArrowRight':
			return void('right' in game && game.right(false));
		case 'ArrowDown':
			return void('down' in game && game.down(false));
		case 'Space':
		case 'KeyX':
			return void('triggerA' in game && game.triggerA(false));
		case 'KeyZ':
			return void('triggerB' in game && game.triggerB(false));
		}
	});
	
	const audio = {rate: audioCtx.sampleRate, frac: 0, samples: [], execute(rate) {
		if (Array.isArray(sound)){
			for (this.frac += this.rate; this.frac >= rate; this.frac -= rate)
				this.samples.push(sound.reduce((a, e) => a + e.output, 0)), sound.forEach(e => e.update());
		}else{
			for (this.frac += this.rate; this.frac >= rate; this.frac -= rate){
				this.samples.push(sound.output), sound.update();
			}
		}
	}};
	//addEventListener('blur', () => audioCtx.suspend().catch());
	
	addEventListener('message', ({data: {timestamp}}) => {
		if (!timestamp)
			return;
		if (game.execute(audio, maxLength), audio.samples.length >= maxLength)
			return samples0 = new Float32Array(audio.samples.slice(0, maxLength)), void audio.samples.splice(0);
			
		const {buffer} = game.makeBitmap(false)
		const {cxScreen, cyScreen, width, xOffset, yOffset} = game
		const array = new Uint8ClampedArray(cxScreen * cyScreen * 4);
		
		for (let y = 0; y < cyScreen; ++y)
			array.set(new Uint8ClampedArray(buffer, (xOffset + (y + yOffset) * width) * 4, cxScreen * 4), y * cxScreen * 4);
		
		images.push({timestamp: timestamp + audio.samples.length / audio.rate, array, cxScreen, cyScreen})
		postMessage({timestamp}, '*');
	});
	game.updateStatus().updateInput(), postMessage({timestamp: maxLength * 2 / audioCtx.sampleRate}, '*');
	
	(audioCtx.onstatechange = () => {
		if (audioCtx.state === 'running') {
			button.src = volume1, button.alt = 'audio state: running';
			source = audioCtx.createBufferSource(), source.connect(node).connect(audioCtx.destination)
			source.start();
		} else {
			button.src = volume0, button.alt = 'audio state: ' + audioCtx.state;
			source && source.stop();
		}
	})();
	
	
	
	requestAnimationFrame(function loop() {
		updateGamepad(game);
		for (; images.length && images[0].timestamp < audioCtx.currentTime; lastFrame = images.shift()) {}
		const {array, cxScreen, cyScreen} = images.length ? images[0] : lastFrame;
		
		ctx.putImageData(new ImageData(array, cxScreen, cyScreen), 0, 0);
		requestAnimationFrame(loop);
	});
}

/*
 *
 *	Array supplementary
 *
 */

if (!Array.prototype.addBase)
	Object.defineProperty(Uint8Array.prototype, 'addBase', {
		value: function () {
			this.base = [];
			for (let begin = 0; begin < this.length; begin += 0x100) {
				const end = Math.min(begin + 0x100, this.length);
				this.base.push(this.subarray(begin, end));
			}
			return this;
		},
		writable: true,
		configurable: true,
	});

/*
 *
 *	Gamepad Module
 *
 */

const haveEvents = 'ongamepadconnected' in window;
const controllers = [];
const gamepadStatus = {up: false, right: false, down: false, left: false, up2: false, right2: false, down2: false, left2: false, buttons: new Array(16).fill(false)};
const buttons = ['triggerA', 'triggerB', 'triggerX', 'triggerY', 'triggerL1', 'triggerR1', 'triggerL2', 'triggerR2', 'coin', 'start1P', 'triggerL3', 'triggerR3', 'up', 'down', 'left', 'right'];

window.addEventListener('gamepadconnected', e => controllers[e.gamepad.index] = e.gamepad);
window.addEventListener('gamepaddisconnected', e => delete controllers[e.gamepad.index]);

function updateGamepad(game) {
	if (!haveEvents) {
		const gamepads = 'getGamepads' in navigator && navigator.getGamepads() || 'webkitGetGamepads' in navigator && navigator.webkitGetGamepads() || [];
		controllers.splice(0);
		for (let i = 0, n = gamepads.length; i < n; i++)
			if (gamepads[i])
				controllers[gamepads[i].index] = gamepads[i];
	}
	const controller = controllers.find(() => true);
	if (!controller)
		return;
	buttons.forEach((button, i) => {
		const val = controller.buttons[i], pressed = typeof val === 'object' ? val.pressed : val === 1.0;
		pressed !== gamepadStatus.buttons[i] && (gamepadStatus.buttons[i] = pressed, button in game && game[button](pressed));
	});
	let pressed;
	(pressed = controller.axes[1] < -0.5) !== gamepadStatus.up     && (gamepadStatus.up     = pressed, 'up'     in game && game.up(    pressed));
	(pressed = controller.axes[0] >  0.5) !== gamepadStatus.right  && (gamepadStatus.right  = pressed, 'right'  in game && game.right( pressed));
	(pressed = controller.axes[1] >  0.5) !== gamepadStatus.down   && (gamepadStatus.down   = pressed, 'down'   in game && game.down(  pressed));
	(pressed = controller.axes[0] < -0.5) !== gamepadStatus.left   && (gamepadStatus.left   = pressed, 'left'   in game && game.left(  pressed));
	(pressed = controller.axes[3] < -0.5) !== gamepadStatus.up2    && (gamepadStatus.up2    = pressed, 'up2'    in game && game.up2(   pressed));
	(pressed = controller.axes[2] >  0.5) !== gamepadStatus.right2 && (gamepadStatus.right2 = pressed, 'right2' in game && game.right2(pressed));
	(pressed = controller.axes[3] >  0.5) !== gamepadStatus.down2  && (gamepadStatus.down2  = pressed, 'down2'  in game && game.down2( pressed));
	(pressed = controller.axes[2] < -0.5) !== gamepadStatus.left2  && (gamepadStatus.left2  = pressed, 'left2'  in game && game.left2( pressed));
}
