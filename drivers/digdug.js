/*
 *
 *	DigDug
 *
 */

import PacManSound from '../libs/EMU.js/devices/SOUND/pac-man_sound.js';
import {seq, rseq, convertGFX, Timer} from '../libs/EMU.js/utils.js';
import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import Z80 from '../libs/EMU.js/devices/CPU/z80.js';
import MB8840 from '../libs/EMU.js/devices/CPU/mb8840.js';
let game, sound;

class DigDug {
	cxScreen = 224;
	cyScreen = 288;
	width = 256;
	height = 512;
	xOffset = 16;
	yOffset = 16;
	rotate = 0;

	fReset = false;
	fTest = false;
	fDIPSwitchChanged = true;
	fCoin = 0;
	fStart1P = 0;
	fStart2P = 0;
	dwStick = 0xf;
	nDigdug = 3;
	nBonus = 'F';
	nRank = 'B';
	fContinue = false;
	fAttract = true;

	fInterruptEnable0 = false;
	fInterruptEnable1 = false;
	fInterruptEnable2 = false;
	fNmiEnable = 0;
	
	ram = new Uint8Array(0x2000).addBase();
	mmi = new Uint8Array(0x100).fill(0xff);
	dmactrl = 0;
	ioport = new Uint8Array(0x100);

	fBG2Attribute = true;
	fBG4Disable = true;
	fFlip = true;
	dwBG4Color = 3;
	dwBG4Select = 3;
	bg2 = new Uint8Array(0x2000).fill(1);
	bg4 = new Uint8Array(0x4000).fill(3);
	obj = new Uint8Array(0x10000).fill(3);
	objcolor = Uint8Array.from(OBJCOLOR, e => 0x10 | e);
	rgb = Int32Array.from(RGB, e => 0xff000000 | (e >> 6) * 255 / 3 << 16 | (e >> 3 & 7) * 255 / 7 << 8 | (e & 7) * 255 / 7);
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;

	cpu = [new Z80(Math.floor(18432000 / 6)), new Z80(Math.floor(18432000 / 6)), new Z80(Math.floor(18432000 / 6))];
	mcu = new MB8840();
	scanline = {rate: 256 * 60, frac: 0, count: 0, execute(rate, fn) {
		for (this.frac += this.rate; this.frac >= rate; this.frac -= rate)
			fn(this.count = this.count + 1 & 255);
	}};
	timer = new Timer(Math.floor(18432000 / 384));

	constructor() {
		//SETUP CPU
		const range = (page, start, end = start, mirror = 0) => (page & ~mirror) >= start && (page & ~mirror) <= end;
		const interrupt = (_mcu) => {
			_mcu.cause = _mcu.cause & ~4 | !_mcu.interrupt() << 2;
			for (let op = _mcu.execute(); op !== 0x3c && (op !== 0x25 || _mcu.cause & 4); op = _mcu.execute())
				op === 0x25 && (_mcu.cause &= ~4);
		};

		for (let page = 0; page < 0x100; page++)
			if (range(page, 0, 0x3f))
				this.cpu[0].memorymap[page].base = PRG1.base[page & 0x3f];
			else if (range(page, 0x68))
				this.cpu[0].memorymap[page].write = (addr, data) => {
					switch (addr & 0xf0) {
					case 0x00:
					case 0x10:
						return sound.write(addr, data);
					case 0x20:
						switch (addr & 0x0f) {
						case 0:
							return void(this.fInterruptEnable0 = (data & 1) !== 0);
						case 1:
							return void(this.fInterruptEnable1 = (data & 1) !== 0);
						case 2:
							return void(this.fInterruptEnable2 = !(data & 1));
						case 3:
							return data & 1 ? (this.cpu[1].enable(), this.cpu[2].enable()) : (this.cpu[1].disable(), this.cpu[2].disable());
						}
					}
				};
			else if (range(page, 0x70)) {
				this.cpu[0].memorymap[page].read = (addr) => {
					let data = 0xff;
					this.dmactrl & 1 && (data &= this.mcu.o, this.mcu.k |= 8, interrupt(this.mcu));
					this.dmactrl & 2 && (data &= this.ioport[addr & 0xff]);
					return data;
				};
				this.cpu[0].memorymap[page].write = (addr, data) => { this.dmactrl & 1 && (this.mcu.k = data & 7, interrupt(this.mcu));	};
			} else if (range(page, 0x71)) {
				this.cpu[0].memorymap[page].read = () => { return this.dmactrl; };
				this.cpu[0].memorymap[page].write = (addr, data) => {
					this.fNmiEnable = 2 << (data >> 5) & ~3;
					switch (this.dmactrl = data) {
					case 0x71:
					case 0xb1:
						if (this.mcu.mask & 4)
							for (this.mcu.execute(); this.mcu.pc !== 0x182; this.mcu.execute()) {}
						return this.mcu.t = this.mcu.t + 1 & 0xff, this.mcu.k |= 8, interrupt(this.mcu);
					case 0xd2:
						return this.ioport.set(this.mmi.subarray(0, 2));
					}
				};
			} else if (range(page, 0x80, 0x87)) {
				this.cpu[0].memorymap[page].base = this.ram.base[page & 7];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0x88, 0x8b, 4)) {
				this.cpu[0].memorymap[page].base = this.ram.base[8 | page & 3];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0x90, 0x93, 4)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x10 | page & 3];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0x98, 0x9b, 4)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x18 | page & 3];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0xa0))
				this.cpu[0].memorymap[0xa0].write = (addr, data) => {
					switch (addr & 7) {
					case 0:
						return void(this.dwBG4Select = this.dwBG4Select & 2 | data & 1);
					case 1:
						return void(this.dwBG4Select = this.dwBG4Select & 1 | data << 1 & 2);
					case 2:
						return void(this.fBG2Attribute = (data & 1) !== 0);
					case 3:
						return void(this.fBG4Disable = (data & 1) !== 0);
					case 4:
						return void(this.dwBG4Color = this.dwBG4Color & 2 | data & 1);
					case 5:
						return void(this.dwBG4Color = this.dwBG4Color & 1 | data << 1 & 2);
					case 7:
						return void(this.fFlip = false);
					}
				};

		for (let page = 0; page < 0x100; page++)
			if (range(page, 0, 0x1f))
				this.cpu[1].memorymap[page].base = PRG2.base[page & 0x1f];
			else if (range(page, 0x40, 0xff))
				this.cpu[1].memorymap[page] = this.cpu[0].memorymap[page];

		for (let page = 0; page < 0x100; page++)
			if (range(page, 0, 0xf))
				this.cpu[2].memorymap[page].base = PRG3.base[page & 0xf];
			else if (range(page, 0x40, 0xff))
				this.cpu[2].memorymap[page] = this.cpu[0].memorymap[page];

		this.mcu.rom.set(IO);
		this.mcu.r = 0xffff;

		this.mmi[0] = 0x99; //DIPSW A
		this.mmi[1] = 0x2e; //DIPSW B

		//SETUP VIDEO
		convertGFX(this.bg2, BG2, 128, rseq(8, 0, 8), rseq(8), [0], 8);
		convertGFX(this.bg4, BG4, 256, rseq(8, 0, 8), seq(4, 64).concat(seq(4)), [0, 4], 16);
		convertGFX(this.obj, OBJ, 256, rseq(8, 256, 8).concat(rseq(8, 0, 8)), seq(4).concat(seq(4, 64), seq(4, 128), seq(4, 192)), [0, 4], 64);
	}

	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			for (let j = 0; j < 3; j++)
				this.cpu[j].execute(tick_rate);
			this.scanline.execute(tick_rate, (vpos) => {
				!(vpos & 0x7f) && this.fInterruptEnable2 && this.cpu[2].non_maskable_interrupt();
				!vpos && (update(), this.fInterruptEnable0 && this.cpu[0].interrupt(), this.fInterruptEnable1 && this.cpu[1].interrupt());
			});
			this.timer.execute(tick_rate, () => {
				this.fNmiEnable && !--this.fNmiEnable && (this.fNmiEnable = 2 << (this.dmactrl >> 5), this.cpu[0].non_maskable_interrupt());
			});
			sound.execute(tick_rate);
			audio.execute(tick_rate);
		}
	}

	reset() {
		this.fReset = true;
	}

	updateStatus() {
		//DIP SWITCH UPDATE
		if (this.fDIPSwitchChanged) {
			this.fDIPSwitchChanged = false;
			switch (this.nDigdug) {
			case 1:
				this.mmi[0] &= 0x3f;
				break;
			case 2:
				this.mmi[0] = this.mmi[0] & 0x3f | 0x40;
				break;
			case 3:
				this.mmi[0] = this.mmi[0] & 0x3f | 0x80;
				break;
			case 5:
				this.mmi[0] |= 0xc0;
				break;
			}
			switch (this.nRank) {
			case 'A':
				this.mmi[1] &= 0xfc;
				break;
			case 'B':
				this.mmi[1] = this.mmi[1] & 0xfc | 0x02;
				break;
			case 'C':
				this.mmi[1] = this.mmi[1] & 0xfc | 0x01;
				break;
			case 'D':
				this.mmi[1] |= 0x03;
				break;
			}
			switch (this.nBonus) {
			case 'NONE':
				this.mmi[0] &= 0xc7;
				break;
			case 'A':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x20;
				break;
			case 'B':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x10;
				break;
			case 'C':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x30;
				break;
			case 'D':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x08;
				break;
			case 'E':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x28;
				break;
			case 'F':
				this.mmi[0] = this.mmi[0] & 0xc7 | 0x18;
				break;
			case 'G':
				this.mmi[0] |= 0x38;
				break;
			}
			if (this.fContinue)
				this.mmi[1] &= 0xf7;
			else
				this.mmi[1] |= 0x08;
			if (this.fAttract)
				this.mmi[1] &= 0xef;
			else
				this.mmi[1] |= 0x10;
			if (!this.fTest)
				this.fReset = true;
		}

		this.mcu.r = this.mcu.r & ~0x8000 | !this.fTest << 15;

		//RESET
		if (this.fReset) {
			this.fReset = false;
			this.fInterruptEnable0 = this.fInterruptEnable1 = this.fInterruptEnable2 = false;
			this.fNmiEnable = 0;
			this.cpu[0].reset();
			this.cpu[1].disable();
			this.cpu[2].disable();
			this.mcu.reset();
			for (; ~this.mcu.mask & 4; this.mcu.execute()) {}
		}
		return this;
	}

	updateInput() {
		this.mcu.r = this.mcu.r & ~0x4c0f | this.dwStick | !this.fCoin << 14 | !this.fStart1P << 10 | !this.fStart2P << 11;
		this.fCoin -= !!this.fCoin, this.fStart1P -= !!this.fStart1P, this.fStart2P -= !!this.fStart2P;
		return this;
	}

	coin(fDown) {
		fDown && (this.fCoin = 2);
	}

	start1P(fDown) {
		fDown && (this.fStart1P = 2);
	}

	start2P(fDown) {
		fDown && (this.fStart2P = 2);
	}

	up(fDown) {
		this.dwStick = this.dwStick & ~(1 << 0) | fDown << 2 | !fDown << 0;
	}

	right(fDown) {
		this.dwStick = this.dwStick & ~(1 << 1) | fDown << 3 | !fDown << 1;
	}

	down(fDown) {
		this.dwStick = this.dwStick & ~(1 << 2) | fDown << 0 | !fDown << 2;
	}

	left(fDown) {
		this.dwStick = this.dwStick & ~(1 << 3) | fDown << 1 | !fDown << 3;
	}

	triggerA(fDown) {
		this.mcu.r = this.mcu.r & ~(1 << 8) | !fDown << 8;
	}

	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;

		//bg drawing
		if (!this.fFlip) {
			let p = 256 * 8 * 4 + 232;
			for (let k = 0x40, i = 0; i < 28; p -= 256 * 8 * 32 + 8, i++)
				for (let j = 0; j < 32; k++, p += 256 * 8, j++)
					this.xfer8x8(this.bitmap, p, k);
			p = 256 * 8 * 36 + 232;
			for (let k = 2, i = 0; i < 28; p -= 8, k++, i++)
				this.xfer8x8(this.bitmap, p, k);
			p = 256 * 8 * 37 + 232;
			for (let k = 0x22, i = 0; i < 28; p -= 8, k++, i++)
				this.xfer8x8(this.bitmap, p, k);
			p = 256 * 8 * 2 + 232;
			for (let k = 0x3c2, i = 0; i < 28; p -= 8, k++, i++)
				this.xfer8x8(this.bitmap, p, k);
			p = 256 * 8 * 3 + 232;
			for (let k = 0x3e2, i = 0; i < 28; p -= 8, k++, i++)
				this.xfer8x8(this.bitmap, p, k);
		} else {
			let p = 256 * 8 * 35 + 16;
			for (let k = 0x40, i = 0; i < 28; p += 256 * 8 * 32 + 8, i++)
				for (let j = 0; j < 32; k++, p -= 256 * 8, j++)
					this.xfer8x8HV(this.bitmap, p, k);
			p = 256 * 8 * 3 + 16;
			for (let k = 2, i = 0; i < 28; p += 8, k++, i++)
				this.xfer8x8HV(this.bitmap, p, k);
			p = 256 * 8 * 2 + 16;
			for (let k = 0x22, i = 0; i < 28; p += 8, k++, i++)
				this.xfer8x8HV(this.bitmap, p, k);
			p = 256 * 8 * 37 + 16;
			for (let k = 0x3c2, i = 0; i < 28; p += 8, k++, i++)
				this.xfer8x8HV(this.bitmap, p, k);
			p = 256 * 8 * 36 + 16;
			for (let k = 0x3e2, i = 0; i < 28; p += 8, k++, i++)
				this.xfer8x8HV(this.bitmap, p, k);
		}

		//obj drawing
		if (!this.fFlip)
			for (let k = 0xb80, i = 64; i !== 0; k += 2, --i) {
				const x = this.ram[k + 0x800] - 1 & 0xff;
				const y = (this.ram[k + 0x801] - 55 & 0xff) + 32;
				if (this.ram[k] < 0x80) {
					const src = this.ram[k] | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16(this.bitmap, x | y << 8, src);
						break;
					case 1: //V invert
						this.xfer16x16V(this.bitmap, x | y << 8, src);
						break;
					case 2: //H invert
						this.xfer16x16H(this.bitmap, x | y << 8, src);
						break;
					case 3: //HV invert
						this.xfer16x16HV(this.bitmap, x | y << 8, src);
						break;
					}
				} else if (this.ram[k] < 0xc0) {
					const src = this.ram[k] << 2 & 0x3c | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16(this.bitmap, x | y << 8, src | 0x82);
						this.xfer16x16(this.bitmap, x | y + 16 << 8, src | 0x83);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y << 8, src | 0x80);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x81);
						break;
					case 1: //V invert
						this.xfer16x16V(this.bitmap, x | y << 8, src | 0x83);
						this.xfer16x16V(this.bitmap, x | y + 16 << 8, src | 0x82);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y << 8, src | 0x81);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x80);
						break;
					case 2: //H invert
						this.xfer16x16H(this.bitmap, x | y << 8, src | 0x80);
						this.xfer16x16H(this.bitmap, x | y + 16 << 8, src | 0x81);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y << 8, src | 0x82);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x83);
						break;
					case 3: //HV invert
						this.xfer16x16HV(this.bitmap, x | y << 8, src | 0x81);
						this.xfer16x16HV(this.bitmap, x | y + 16 << 8, src | 0x80);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y << 8, src | 0x83);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x82);
						break;
					}
				} else {
					const src = this.ram[k] << 2 & 0x3c | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16(this.bitmap, x | y << 8, src | 0xc2);
						this.xfer16x16(this.bitmap, x | y + 16 << 8, src | 0xc3);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc0);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc1);
						break;
					case 1: //V invert
						this.xfer16x16V(this.bitmap, x | y << 8, src | 0xc3);
						this.xfer16x16V(this.bitmap, x | y + 16 << 8, src | 0xc2);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc1);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc0);
						break;
					case 2: //H invert
						this.xfer16x16H(this.bitmap, x | y << 8, src | 0xc0);
						this.xfer16x16H(this.bitmap, x | y + 16 << 8, src | 0xc1);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc2);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc3);
						break;
					case 3: //HV invert
						this.xfer16x16HV(this.bitmap, x | y << 8, src | 0xc1);
						this.xfer16x16HV(this.bitmap, x | y + 16 << 8, src | 0xc0);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc3);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc2);
						break;
					}
				}
			}
		else
			for (let k = 0xb80, i = 64; i !== 0; k += 2, --i) {
				const x = this.ram[k + 0x800] - 1 & 0xff;
				const y = (this.ram[k + 0x801] - 55 & 0xff) + 32;
				if (this.ram[k] < 0x80) {
					const src = this.ram[k] | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16HV(this.bitmap, x | y << 8, src);
						break;
					case 1: //V invert
						this.xfer16x16H(this.bitmap, x | y << 8, src);
						break;
					case 2: //H invert
						this.xfer16x16V(this.bitmap, x | y << 8, src);
						break;
					case 3: //HV invert
						this.xfer16x16(this.bitmap, x | y << 8, src);
						break;
					}
				} else if (this.ram[k] < 0xc0) {
					const src = this.ram[k] << 2 & 0x3c | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16HV(this.bitmap, x | y << 8, src | 0x81);
						this.xfer16x16HV(this.bitmap, x | y + 16 << 8, src | 0x80);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y << 8, src | 0x83);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x82);
						break;
					case 1: //V invert
						this.xfer16x16H(this.bitmap, x | y << 8, src | 0x80);
						this.xfer16x16H(this.bitmap, x | y + 16 << 8, src | 0x81);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y << 8, src | 0x82);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x83);
						break;
					case 2: //H invert
						this.xfer16x16V(this.bitmap, x | y << 8, src | 0x83);
						this.xfer16x16V(this.bitmap, x | y + 16 << 8, src | 0x82);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y << 8, src | 0x81);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x80);
						break;
					case 3: //HV invert
						this.xfer16x16(this.bitmap, x | y << 8, src | 0x82);
						this.xfer16x16(this.bitmap, x | y + 16 << 8, src | 0x83);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y << 8, src | 0x80);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0x81);
						break;
					}
				} else {
					const src = this.ram[k] << 2 & 0x3c | this.ram[k + 1] << 8;
					switch (this.ram[k + 0x1000] & 3) {
					case 0: //normal
						this.xfer16x16HV(this.bitmap, x | y << 8, src | 0xc1);
						this.xfer16x16HV(this.bitmap, x | y + 16 << 8, src | 0xc0);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc3);
						this.xfer16x16HV(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc2);
						break;
					case 1: //V invert
						this.xfer16x16H(this.bitmap, x | y << 8, src | 0xc0);
						this.xfer16x16H(this.bitmap, x | y + 16 << 8, src | 0xc1);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc2);
						this.xfer16x16H(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc3);
						break;
					case 2: //H invert
						this.xfer16x16V(this.bitmap, x | y << 8, src | 0xc3);
						this.xfer16x16V(this.bitmap, x | y + 16 << 8, src | 0xc2);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc1);
						this.xfer16x16V(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc0);
						break;
					case 3: //HV invert
						this.xfer16x16(this.bitmap, x | y << 8, src | 0xc2);
						this.xfer16x16(this.bitmap, x | y + 16 << 8, src | 0xc3);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y << 8, src | 0xc0);
						this.xfer16x16(this.bitmap, x + 16 & 0xff | y + 16 << 8, src | 0xc1);
						break;
					}
				}
			}

		//update palette
		let p = 256 * 16 + 16;
		for (let i = 0; i < 288; p += 256 - 224, i++)
			for (let j = 0; j < 224; p++, j++)
				this.bitmap[p] = this.rgb[this.bitmap[p]];

		return this.bitmap;
	}

	xfer8x8(data, p, k) {
		const color = this.fBG2Attribute ? this.ram[k + 0x400] & 0xf : this.ram[k] >> 4 & 0xe | this.ram[k] >> 3 & 2;
		const q = this.ram[k] << 6 & 0x1fc0, r = MAPDATA[k | this.dwBG4Select << 10] << 6, idx = MAPDATA[k | this.dwBG4Select << 10] >> 2 & 0x3c | this.dwBG4Color << 6;

		if (this.fBG4Disable) {
			data[p + 0x000] = this.bg2[q | 0x00] * color;
			data[p + 0x001] = this.bg2[q | 0x01] * color;
			data[p + 0x002] = this.bg2[q | 0x02] * color;
			data[p + 0x003] = this.bg2[q | 0x03] * color;
			data[p + 0x004] = this.bg2[q | 0x04] * color;
			data[p + 0x005] = this.bg2[q | 0x05] * color;
			data[p + 0x006] = this.bg2[q | 0x06] * color;
			data[p + 0x007] = this.bg2[q | 0x07] * color;
			data[p + 0x100] = this.bg2[q | 0x08] * color;
			data[p + 0x101] = this.bg2[q | 0x09] * color;
			data[p + 0x102] = this.bg2[q | 0x0a] * color;
			data[p + 0x103] = this.bg2[q | 0x0b] * color;
			data[p + 0x104] = this.bg2[q | 0x0c] * color;
			data[p + 0x105] = this.bg2[q | 0x0d] * color;
			data[p + 0x106] = this.bg2[q | 0x0e] * color;
			data[p + 0x107] = this.bg2[q | 0x0f] * color;
			data[p + 0x200] = this.bg2[q | 0x10] * color;
			data[p + 0x201] = this.bg2[q | 0x11] * color;
			data[p + 0x202] = this.bg2[q | 0x12] * color;
			data[p + 0x203] = this.bg2[q | 0x13] * color;
			data[p + 0x204] = this.bg2[q | 0x14] * color;
			data[p + 0x205] = this.bg2[q | 0x15] * color;
			data[p + 0x206] = this.bg2[q | 0x16] * color;
			data[p + 0x207] = this.bg2[q | 0x17] * color;
			data[p + 0x300] = this.bg2[q | 0x18] * color;
			data[p + 0x301] = this.bg2[q | 0x19] * color;
			data[p + 0x302] = this.bg2[q | 0x1a] * color;
			data[p + 0x303] = this.bg2[q | 0x1b] * color;
			data[p + 0x304] = this.bg2[q | 0x1c] * color;
			data[p + 0x305] = this.bg2[q | 0x1d] * color;
			data[p + 0x306] = this.bg2[q | 0x1e] * color;
			data[p + 0x307] = this.bg2[q | 0x1f] * color;
			data[p + 0x400] = this.bg2[q | 0x20] * color;
			data[p + 0x401] = this.bg2[q | 0x21] * color;
			data[p + 0x402] = this.bg2[q | 0x22] * color;
			data[p + 0x403] = this.bg2[q | 0x23] * color;
			data[p + 0x404] = this.bg2[q | 0x24] * color;
			data[p + 0x405] = this.bg2[q | 0x25] * color;
			data[p + 0x406] = this.bg2[q | 0x26] * color;
			data[p + 0x407] = this.bg2[q | 0x27] * color;
			data[p + 0x500] = this.bg2[q | 0x28] * color;
			data[p + 0x501] = this.bg2[q | 0x29] * color;
			data[p + 0x502] = this.bg2[q | 0x2a] * color;
			data[p + 0x503] = this.bg2[q | 0x2b] * color;
			data[p + 0x504] = this.bg2[q | 0x2c] * color;
			data[p + 0x505] = this.bg2[q | 0x2d] * color;
			data[p + 0x506] = this.bg2[q | 0x2e] * color;
			data[p + 0x507] = this.bg2[q | 0x2f] * color;
			data[p + 0x600] = this.bg2[q | 0x30] * color;
			data[p + 0x601] = this.bg2[q | 0x31] * color;
			data[p + 0x602] = this.bg2[q | 0x32] * color;
			data[p + 0x603] = this.bg2[q | 0x33] * color;
			data[p + 0x604] = this.bg2[q | 0x34] * color;
			data[p + 0x605] = this.bg2[q | 0x35] * color;
			data[p + 0x606] = this.bg2[q | 0x36] * color;
			data[p + 0x607] = this.bg2[q | 0x37] * color;
			data[p + 0x700] = this.bg2[q | 0x38] * color;
			data[p + 0x701] = this.bg2[q | 0x39] * color;
			data[p + 0x702] = this.bg2[q | 0x3a] * color;
			data[p + 0x703] = this.bg2[q | 0x3b] * color;
			data[p + 0x704] = this.bg2[q | 0x3c] * color;
			data[p + 0x705] = this.bg2[q | 0x3d] * color;
			data[p + 0x706] = this.bg2[q | 0x3e] * color;
			data[p + 0x707] = this.bg2[q | 0x3f] * color;
		} else {
			data[p + 0x000] = this.bg2[q | 0x00] ? color : BGCOLOR[idx | this.bg4[r | 0x00]];
			data[p + 0x001] = this.bg2[q | 0x01] ? color : BGCOLOR[idx | this.bg4[r | 0x01]];
			data[p + 0x002] = this.bg2[q | 0x02] ? color : BGCOLOR[idx | this.bg4[r | 0x02]];
			data[p + 0x003] = this.bg2[q | 0x03] ? color : BGCOLOR[idx | this.bg4[r | 0x03]];
			data[p + 0x004] = this.bg2[q | 0x04] ? color : BGCOLOR[idx | this.bg4[r | 0x04]];
			data[p + 0x005] = this.bg2[q | 0x05] ? color : BGCOLOR[idx | this.bg4[r | 0x05]];
			data[p + 0x006] = this.bg2[q | 0x06] ? color : BGCOLOR[idx | this.bg4[r | 0x06]];
			data[p + 0x007] = this.bg2[q | 0x07] ? color : BGCOLOR[idx | this.bg4[r | 0x07]];
			data[p + 0x100] = this.bg2[q | 0x08] ? color : BGCOLOR[idx | this.bg4[r | 0x08]];
			data[p + 0x101] = this.bg2[q | 0x09] ? color : BGCOLOR[idx | this.bg4[r | 0x09]];
			data[p + 0x102] = this.bg2[q | 0x0a] ? color : BGCOLOR[idx | this.bg4[r | 0x0a]];
			data[p + 0x103] = this.bg2[q | 0x0b] ? color : BGCOLOR[idx | this.bg4[r | 0x0b]];
			data[p + 0x104] = this.bg2[q | 0x0c] ? color : BGCOLOR[idx | this.bg4[r | 0x0c]];
			data[p + 0x105] = this.bg2[q | 0x0d] ? color : BGCOLOR[idx | this.bg4[r | 0x0d]];
			data[p + 0x106] = this.bg2[q | 0x0e] ? color : BGCOLOR[idx | this.bg4[r | 0x0e]];
			data[p + 0x107] = this.bg2[q | 0x0f] ? color : BGCOLOR[idx | this.bg4[r | 0x0f]];
			data[p + 0x200] = this.bg2[q | 0x10] ? color : BGCOLOR[idx | this.bg4[r | 0x10]];
			data[p + 0x201] = this.bg2[q | 0x11] ? color : BGCOLOR[idx | this.bg4[r | 0x11]];
			data[p + 0x202] = this.bg2[q | 0x12] ? color : BGCOLOR[idx | this.bg4[r | 0x12]];
			data[p + 0x203] = this.bg2[q | 0x13] ? color : BGCOLOR[idx | this.bg4[r | 0x13]];
			data[p + 0x204] = this.bg2[q | 0x14] ? color : BGCOLOR[idx | this.bg4[r | 0x14]];
			data[p + 0x205] = this.bg2[q | 0x15] ? color : BGCOLOR[idx | this.bg4[r | 0x15]];
			data[p + 0x206] = this.bg2[q | 0x16] ? color : BGCOLOR[idx | this.bg4[r | 0x16]];
			data[p + 0x207] = this.bg2[q | 0x17] ? color : BGCOLOR[idx | this.bg4[r | 0x17]];
			data[p + 0x300] = this.bg2[q | 0x18] ? color : BGCOLOR[idx | this.bg4[r | 0x18]];
			data[p + 0x301] = this.bg2[q | 0x19] ? color : BGCOLOR[idx | this.bg4[r | 0x19]];
			data[p + 0x302] = this.bg2[q | 0x1a] ? color : BGCOLOR[idx | this.bg4[r | 0x1a]];
			data[p + 0x303] = this.bg2[q | 0x1b] ? color : BGCOLOR[idx | this.bg4[r | 0x1b]];
			data[p + 0x304] = this.bg2[q | 0x1c] ? color : BGCOLOR[idx | this.bg4[r | 0x1c]];
			data[p + 0x305] = this.bg2[q | 0x1d] ? color : BGCOLOR[idx | this.bg4[r | 0x1d]];
			data[p + 0x306] = this.bg2[q | 0x1e] ? color : BGCOLOR[idx | this.bg4[r | 0x1e]];
			data[p + 0x307] = this.bg2[q | 0x1f] ? color : BGCOLOR[idx | this.bg4[r | 0x1f]];
			data[p + 0x400] = this.bg2[q | 0x20] ? color : BGCOLOR[idx | this.bg4[r | 0x20]];
			data[p + 0x401] = this.bg2[q | 0x21] ? color : BGCOLOR[idx | this.bg4[r | 0x21]];
			data[p + 0x402] = this.bg2[q | 0x22] ? color : BGCOLOR[idx | this.bg4[r | 0x22]];
			data[p + 0x403] = this.bg2[q | 0x23] ? color : BGCOLOR[idx | this.bg4[r | 0x23]];
			data[p + 0x404] = this.bg2[q | 0x24] ? color : BGCOLOR[idx | this.bg4[r | 0x24]];
			data[p + 0x405] = this.bg2[q | 0x25] ? color : BGCOLOR[idx | this.bg4[r | 0x25]];
			data[p + 0x406] = this.bg2[q | 0x26] ? color : BGCOLOR[idx | this.bg4[r | 0x26]];
			data[p + 0x407] = this.bg2[q | 0x27] ? color : BGCOLOR[idx | this.bg4[r | 0x27]];
			data[p + 0x500] = this.bg2[q | 0x28] ? color : BGCOLOR[idx | this.bg4[r | 0x28]];
			data[p + 0x501] = this.bg2[q | 0x29] ? color : BGCOLOR[idx | this.bg4[r | 0x29]];
			data[p + 0x502] = this.bg2[q | 0x2a] ? color : BGCOLOR[idx | this.bg4[r | 0x2a]];
			data[p + 0x503] = this.bg2[q | 0x2b] ? color : BGCOLOR[idx | this.bg4[r | 0x2b]];
			data[p + 0x504] = this.bg2[q | 0x2c] ? color : BGCOLOR[idx | this.bg4[r | 0x2c]];
			data[p + 0x505] = this.bg2[q | 0x2d] ? color : BGCOLOR[idx | this.bg4[r | 0x2d]];
			data[p + 0x506] = this.bg2[q | 0x2e] ? color : BGCOLOR[idx | this.bg4[r | 0x2e]];
			data[p + 0x507] = this.bg2[q | 0x2f] ? color : BGCOLOR[idx | this.bg4[r | 0x2f]];
			data[p + 0x600] = this.bg2[q | 0x30] ? color : BGCOLOR[idx | this.bg4[r | 0x30]];
			data[p + 0x601] = this.bg2[q | 0x31] ? color : BGCOLOR[idx | this.bg4[r | 0x31]];
			data[p + 0x602] = this.bg2[q | 0x32] ? color : BGCOLOR[idx | this.bg4[r | 0x32]];
			data[p + 0x603] = this.bg2[q | 0x33] ? color : BGCOLOR[idx | this.bg4[r | 0x33]];
			data[p + 0x604] = this.bg2[q | 0x34] ? color : BGCOLOR[idx | this.bg4[r | 0x34]];
			data[p + 0x605] = this.bg2[q | 0x35] ? color : BGCOLOR[idx | this.bg4[r | 0x35]];
			data[p + 0x606] = this.bg2[q | 0x36] ? color : BGCOLOR[idx | this.bg4[r | 0x36]];
			data[p + 0x607] = this.bg2[q | 0x37] ? color : BGCOLOR[idx | this.bg4[r | 0x37]];
			data[p + 0x700] = this.bg2[q | 0x38] ? color : BGCOLOR[idx | this.bg4[r | 0x38]];
			data[p + 0x701] = this.bg2[q | 0x39] ? color : BGCOLOR[idx | this.bg4[r | 0x39]];
			data[p + 0x702] = this.bg2[q | 0x3a] ? color : BGCOLOR[idx | this.bg4[r | 0x3a]];
			data[p + 0x703] = this.bg2[q | 0x3b] ? color : BGCOLOR[idx | this.bg4[r | 0x3b]];
			data[p + 0x704] = this.bg2[q | 0x3c] ? color : BGCOLOR[idx | this.bg4[r | 0x3c]];
			data[p + 0x705] = this.bg2[q | 0x3d] ? color : BGCOLOR[idx | this.bg4[r | 0x3d]];
			data[p + 0x706] = this.bg2[q | 0x3e] ? color : BGCOLOR[idx | this.bg4[r | 0x3e]];
			data[p + 0x707] = this.bg2[q | 0x3f] ? color : BGCOLOR[idx | this.bg4[r | 0x3f]];
		}
	}

	xfer8x8HV(data, p, k) {
		const color = this.fBG2Attribute ? this.ram[k + 0x400] & 0xf : this.ram[k] >> 4 & 0xe | this.ram[k] >> 3 & 2;
		const q = this.ram[k] << 6 & 0x1fc0, r = MAPDATA[k | this.dwBG4Select << 10] << 6, idx = MAPDATA[k | this.dwBG4Select << 10] >> 2 & 0x3c | this.dwBG4Color << 6;

		if (this.fBG4Disable) {
			data[p + 0x000] = this.bg2[q | 0x3f] * color;
			data[p + 0x001] = this.bg2[q | 0x3e] * color;
			data[p + 0x002] = this.bg2[q | 0x3d] * color;
			data[p + 0x003] = this.bg2[q | 0x3c] * color;
			data[p + 0x004] = this.bg2[q | 0x3b] * color;
			data[p + 0x005] = this.bg2[q | 0x3a] * color;
			data[p + 0x006] = this.bg2[q | 0x39] * color;
			data[p + 0x007] = this.bg2[q | 0x38] * color;
			data[p + 0x100] = this.bg2[q | 0x37] * color;
			data[p + 0x101] = this.bg2[q | 0x36] * color;
			data[p + 0x102] = this.bg2[q | 0x35] * color;
			data[p + 0x103] = this.bg2[q | 0x34] * color;
			data[p + 0x104] = this.bg2[q | 0x33] * color;
			data[p + 0x105] = this.bg2[q | 0x32] * color;
			data[p + 0x106] = this.bg2[q | 0x31] * color;
			data[p + 0x107] = this.bg2[q | 0x30] * color;
			data[p + 0x200] = this.bg2[q | 0x2f] * color;
			data[p + 0x201] = this.bg2[q | 0x2e] * color;
			data[p + 0x202] = this.bg2[q | 0x2d] * color;
			data[p + 0x203] = this.bg2[q | 0x2c] * color;
			data[p + 0x204] = this.bg2[q | 0x2b] * color;
			data[p + 0x205] = this.bg2[q | 0x2a] * color;
			data[p + 0x206] = this.bg2[q | 0x29] * color;
			data[p + 0x207] = this.bg2[q | 0x28] * color;
			data[p + 0x300] = this.bg2[q | 0x27] * color;
			data[p + 0x301] = this.bg2[q | 0x26] * color;
			data[p + 0x302] = this.bg2[q | 0x25] * color;
			data[p + 0x303] = this.bg2[q | 0x24] * color;
			data[p + 0x304] = this.bg2[q | 0x23] * color;
			data[p + 0x305] = this.bg2[q | 0x22] * color;
			data[p + 0x306] = this.bg2[q | 0x21] * color;
			data[p + 0x307] = this.bg2[q | 0x20] * color;
			data[p + 0x400] = this.bg2[q | 0x1f] * color;
			data[p + 0x401] = this.bg2[q | 0x1e] * color;
			data[p + 0x402] = this.bg2[q | 0x1d] * color;
			data[p + 0x403] = this.bg2[q | 0x1c] * color;
			data[p + 0x404] = this.bg2[q | 0x1b] * color;
			data[p + 0x405] = this.bg2[q | 0x1a] * color;
			data[p + 0x406] = this.bg2[q | 0x19] * color;
			data[p + 0x407] = this.bg2[q | 0x18] * color;
			data[p + 0x500] = this.bg2[q | 0x17] * color;
			data[p + 0x501] = this.bg2[q | 0x16] * color;
			data[p + 0x502] = this.bg2[q | 0x15] * color;
			data[p + 0x503] = this.bg2[q | 0x14] * color;
			data[p + 0x504] = this.bg2[q | 0x13] * color;
			data[p + 0x505] = this.bg2[q | 0x12] * color;
			data[p + 0x506] = this.bg2[q | 0x11] * color;
			data[p + 0x507] = this.bg2[q | 0x10] * color;
			data[p + 0x600] = this.bg2[q | 0x0f] * color;
			data[p + 0x601] = this.bg2[q | 0x0e] * color;
			data[p + 0x602] = this.bg2[q | 0x0d] * color;
			data[p + 0x603] = this.bg2[q | 0x0c] * color;
			data[p + 0x604] = this.bg2[q | 0x0b] * color;
			data[p + 0x605] = this.bg2[q | 0x0a] * color;
			data[p + 0x606] = this.bg2[q | 0x09] * color;
			data[p + 0x607] = this.bg2[q | 0x08] * color;
			data[p + 0x700] = this.bg2[q | 0x07] * color;
			data[p + 0x701] = this.bg2[q | 0x06] * color;
			data[p + 0x702] = this.bg2[q | 0x05] * color;
			data[p + 0x703] = this.bg2[q | 0x04] * color;
			data[p + 0x704] = this.bg2[q | 0x03] * color;
			data[p + 0x705] = this.bg2[q | 0x02] * color;
			data[p + 0x706] = this.bg2[q | 0x01] * color;
			data[p + 0x707] = this.bg2[q | 0x00] * color;
		} else {
			data[p + 0x000] = this.bg2[q | 0x3f] ? color : BGCOLOR[idx | this.bg4[r | 0x3f]];
			data[p + 0x001] = this.bg2[q | 0x3e] ? color : BGCOLOR[idx | this.bg4[r | 0x3e]];
			data[p + 0x002] = this.bg2[q | 0x3d] ? color : BGCOLOR[idx | this.bg4[r | 0x3d]];
			data[p + 0x003] = this.bg2[q | 0x3c] ? color : BGCOLOR[idx | this.bg4[r | 0x3c]];
			data[p + 0x004] = this.bg2[q | 0x3b] ? color : BGCOLOR[idx | this.bg4[r | 0x3b]];
			data[p + 0x005] = this.bg2[q | 0x3a] ? color : BGCOLOR[idx | this.bg4[r | 0x3a]];
			data[p + 0x006] = this.bg2[q | 0x39] ? color : BGCOLOR[idx | this.bg4[r | 0x39]];
			data[p + 0x007] = this.bg2[q | 0x38] ? color : BGCOLOR[idx | this.bg4[r | 0x38]];
			data[p + 0x100] = this.bg2[q | 0x37] ? color : BGCOLOR[idx | this.bg4[r | 0x37]];
			data[p + 0x101] = this.bg2[q | 0x36] ? color : BGCOLOR[idx | this.bg4[r | 0x36]];
			data[p + 0x102] = this.bg2[q | 0x35] ? color : BGCOLOR[idx | this.bg4[r | 0x35]];
			data[p + 0x103] = this.bg2[q | 0x34] ? color : BGCOLOR[idx | this.bg4[r | 0x34]];
			data[p + 0x104] = this.bg2[q | 0x33] ? color : BGCOLOR[idx | this.bg4[r | 0x33]];
			data[p + 0x105] = this.bg2[q | 0x32] ? color : BGCOLOR[idx | this.bg4[r | 0x32]];
			data[p + 0x106] = this.bg2[q | 0x31] ? color : BGCOLOR[idx | this.bg4[r | 0x31]];
			data[p + 0x107] = this.bg2[q | 0x30] ? color : BGCOLOR[idx | this.bg4[r | 0x30]];
			data[p + 0x200] = this.bg2[q | 0x2f] ? color : BGCOLOR[idx | this.bg4[r | 0x2f]];
			data[p + 0x201] = this.bg2[q | 0x2e] ? color : BGCOLOR[idx | this.bg4[r | 0x2e]];
			data[p + 0x202] = this.bg2[q | 0x2d] ? color : BGCOLOR[idx | this.bg4[r | 0x2d]];
			data[p + 0x203] = this.bg2[q | 0x2c] ? color : BGCOLOR[idx | this.bg4[r | 0x2c]];
			data[p + 0x204] = this.bg2[q | 0x2b] ? color : BGCOLOR[idx | this.bg4[r | 0x2b]];
			data[p + 0x205] = this.bg2[q | 0x2a] ? color : BGCOLOR[idx | this.bg4[r | 0x2a]];
			data[p + 0x206] = this.bg2[q | 0x29] ? color : BGCOLOR[idx | this.bg4[r | 0x29]];
			data[p + 0x207] = this.bg2[q | 0x28] ? color : BGCOLOR[idx | this.bg4[r | 0x28]];
			data[p + 0x300] = this.bg2[q | 0x27] ? color : BGCOLOR[idx | this.bg4[r | 0x27]];
			data[p + 0x301] = this.bg2[q | 0x26] ? color : BGCOLOR[idx | this.bg4[r | 0x26]];
			data[p + 0x302] = this.bg2[q | 0x25] ? color : BGCOLOR[idx | this.bg4[r | 0x25]];
			data[p + 0x303] = this.bg2[q | 0x24] ? color : BGCOLOR[idx | this.bg4[r | 0x24]];
			data[p + 0x304] = this.bg2[q | 0x23] ? color : BGCOLOR[idx | this.bg4[r | 0x23]];
			data[p + 0x305] = this.bg2[q | 0x22] ? color : BGCOLOR[idx | this.bg4[r | 0x22]];
			data[p + 0x306] = this.bg2[q | 0x21] ? color : BGCOLOR[idx | this.bg4[r | 0x21]];
			data[p + 0x307] = this.bg2[q | 0x20] ? color : BGCOLOR[idx | this.bg4[r | 0x20]];
			data[p + 0x400] = this.bg2[q | 0x1f] ? color : BGCOLOR[idx | this.bg4[r | 0x1f]];
			data[p + 0x401] = this.bg2[q | 0x1e] ? color : BGCOLOR[idx | this.bg4[r | 0x1e]];
			data[p + 0x402] = this.bg2[q | 0x1d] ? color : BGCOLOR[idx | this.bg4[r | 0x1d]];
			data[p + 0x403] = this.bg2[q | 0x1c] ? color : BGCOLOR[idx | this.bg4[r | 0x1c]];
			data[p + 0x404] = this.bg2[q | 0x1b] ? color : BGCOLOR[idx | this.bg4[r | 0x1b]];
			data[p + 0x405] = this.bg2[q | 0x1a] ? color : BGCOLOR[idx | this.bg4[r | 0x1a]];
			data[p + 0x406] = this.bg2[q | 0x19] ? color : BGCOLOR[idx | this.bg4[r | 0x19]];
			data[p + 0x407] = this.bg2[q | 0x18] ? color : BGCOLOR[idx | this.bg4[r | 0x18]];
			data[p + 0x500] = this.bg2[q | 0x17] ? color : BGCOLOR[idx | this.bg4[r | 0x17]];
			data[p + 0x501] = this.bg2[q | 0x16] ? color : BGCOLOR[idx | this.bg4[r | 0x16]];
			data[p + 0x502] = this.bg2[q | 0x15] ? color : BGCOLOR[idx | this.bg4[r | 0x15]];
			data[p + 0x503] = this.bg2[q | 0x14] ? color : BGCOLOR[idx | this.bg4[r | 0x14]];
			data[p + 0x504] = this.bg2[q | 0x13] ? color : BGCOLOR[idx | this.bg4[r | 0x13]];
			data[p + 0x505] = this.bg2[q | 0x12] ? color : BGCOLOR[idx | this.bg4[r | 0x12]];
			data[p + 0x506] = this.bg2[q | 0x11] ? color : BGCOLOR[idx | this.bg4[r | 0x11]];
			data[p + 0x507] = this.bg2[q | 0x10] ? color : BGCOLOR[idx | this.bg4[r | 0x10]];
			data[p + 0x600] = this.bg2[q | 0x0f] ? color : BGCOLOR[idx | this.bg4[r | 0x0f]];
			data[p + 0x601] = this.bg2[q | 0x0e] ? color : BGCOLOR[idx | this.bg4[r | 0x0e]];
			data[p + 0x602] = this.bg2[q | 0x0d] ? color : BGCOLOR[idx | this.bg4[r | 0x0d]];
			data[p + 0x603] = this.bg2[q | 0x0c] ? color : BGCOLOR[idx | this.bg4[r | 0x0c]];
			data[p + 0x604] = this.bg2[q | 0x0b] ? color : BGCOLOR[idx | this.bg4[r | 0x0b]];
			data[p + 0x605] = this.bg2[q | 0x0a] ? color : BGCOLOR[idx | this.bg4[r | 0x0a]];
			data[p + 0x606] = this.bg2[q | 0x09] ? color : BGCOLOR[idx | this.bg4[r | 0x09]];
			data[p + 0x607] = this.bg2[q | 0x08] ? color : BGCOLOR[idx | this.bg4[r | 0x08]];
			data[p + 0x700] = this.bg2[q | 0x07] ? color : BGCOLOR[idx | this.bg4[r | 0x07]];
			data[p + 0x701] = this.bg2[q | 0x06] ? color : BGCOLOR[idx | this.bg4[r | 0x06]];
			data[p + 0x702] = this.bg2[q | 0x05] ? color : BGCOLOR[idx | this.bg4[r | 0x05]];
			data[p + 0x703] = this.bg2[q | 0x04] ? color : BGCOLOR[idx | this.bg4[r | 0x04]];
			data[p + 0x704] = this.bg2[q | 0x03] ? color : BGCOLOR[idx | this.bg4[r | 0x03]];
			data[p + 0x705] = this.bg2[q | 0x02] ? color : BGCOLOR[idx | this.bg4[r | 0x02]];
			data[p + 0x706] = this.bg2[q | 0x01] ? color : BGCOLOR[idx | this.bg4[r | 0x01]];
			data[p + 0x707] = this.bg2[q | 0x00] ? color : BGCOLOR[idx | this.bg4[r | 0x00]];
		}
	}

	xfer16x16(data, dst, src) {
		const idx = src >> 6 & 0xfc;
		let px, h;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240)
			return;
		if (dst >= 288 * 0x100)
			dst -= 0x10000;
		if ((h = 288 - (dst >> 8)) >= 16) {
			src = src << 8 & 0xff00;
			for (let i = 16; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
		} else {
			src = src << 8 & 0xff00;
			for (let i = h; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
			dst -= 0x10000;
			for (let i = 16 - h; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
		}
	}

	xfer16x16V(data, dst, src) {
		const idx = src >> 6 & 0xfc;
		let px, h;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240)
			return;
		if (dst >= 288 * 0x100)
			dst -= 0x10000;
		if ((h = 288 - (dst >> 8)) >= 16) {
			src = (src << 8 & 0xff00) + 256 - 16;
			for (let i = 16; i !== 0; dst += 256 - 16, src -= 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
		} else {
			src = (src << 8 & 0xff00) + 256 - 16;
			for (let i = h; i !== 0; dst += 256 - 16, src -= 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
			dst -= 0x10000;
			for (let i = 16 - h; i !== 0; dst += 256 - 16, src -= 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[src++]]) !== 0x1f)
						data[dst] = px;
		}
	}

	xfer16x16H(data, dst, src) {
		const idx = src >> 6 & 0xfc;
		let px, h;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240)
			return;
		if (dst >= 288 * 0x100)
			dst -= 0x10000;
		if ((h = 288 - (dst >> 8)) >= 16) {
			src = (src << 8 & 0xff00) + 16;
			for (let i = 16; i !== 0; dst += 256 - 16, src += 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
		} else {
			src = (src << 8 & 0xff00) + 16;
			for (let i = h; i !== 0; dst += 256 - 16, src += 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
			dst -= 0x10000;
			for (let i = 16 - h; i !== 0; dst += 256 - 16, src += 32, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
		}
	}

	xfer16x16HV(data, dst, src) {
		const idx = src >> 6 & 0xfc;
		let px, h;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240)
			return;
		if (dst >= 288 * 0x100)
			dst -= 0x10000;
		if ((h = 288 - (dst >> 8)) >= 16) {
			src = (src << 8 & 0xff00) + 256;
			for (let i = 16; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
		} else {
			src = (src << 8 & 0xff00) + 256;
			for (let i = h; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
			dst -= 0x10000;
			for (let i = 16 - h; i !== 0; dst += 256 - 16, --i)
				for (let j = 16; j !== 0; dst++, --j)
					if ((px = this.objcolor[idx | this.obj[--src]]) !== 0x1f)
						data[dst] = px;
		}
	}
}

/*
 *
 *	DigDug
 *
 */
 

const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		// Mame name  'digdug'
		display_name: 'Dig Dug (rev 2)',
		developer: 'Namco',
		year: '1982',
		Notes: '',

		driver: DigDug,
		romsets: [
			{
				archive_name: 'digdug',
				mappings: [
				{
					name: 'PRG1',
					roms: ['dd1a.1','dd1a.2','dd1a.3','dd1a.4'],
				},
				{
					name: 'PRG2',
					roms: ['dd1a.5','dd1a.6'],
				},
				{
					name: 'PRG3',
					roms: ['dd1.7'],
				},
				{
					name: 'BG2',
					roms: ['dd1.9'],
				},
				{
					name: 'BG4',
					roms: ['dd1.11'],
				},
				{
					name: 'OBJ',
					roms: ['dd1.15','dd1.14','dd1.13','dd1.12'],
				},
				{
					name: 'MAPDATA',
					roms: ['dd1.10b'],
				},
				{
					name: 'RGB',
					roms: ['136007.113'],
				},
				{
					name: 'OBJCOLOR',
					roms: ['136007.111'],
				},
				{
					name: 'BGCOLOR',
					roms: ['136007.112'],
				},
				{
					name: 'SND',
					roms: ['136007.110'],
				},
				]
			},
			{
				archive_name: 'namco51',
				mappings: [
				{
					name: 'IO',
					roms: ['51xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'digdug1'
		display_name: 'Dig Dug (rev 1)',
		developer: 'Namco',
		year: '1982',
		Notes: '',

		driver: DigDug,
		romsets: [
			{
				archive_name: 'digdug',
				mappings: [
				{
					name: 'PRG1',
					roms: ['dd1.1','dd1.2','dd1.3','dd1.4b'],
				},
				{
					name: 'PRG2',
					roms: ['dd1.5b','dd1.6b'],
				},
				{
					name: 'PRG3',
					roms: ['dd1.7'],
				},
				{
					name: 'BG2',
					roms: ['dd1.9'],
				},
				{
					name: 'BG4',
					roms: ['dd1.11'],
				},
				{
					name: 'OBJ',
					roms: ['dd1.15','dd1.14','dd1.13','dd1.12'],
				},
				{
					name: 'MAPDATA',
					roms: ['dd1.10b'],
				},
				{
					name: 'RGB',
					roms: ['136007.113'],
				},
				{
					name: 'OBJCOLOR',
					roms: ['136007.111'],
				},
				{
					name: 'BGCOLOR',
					roms: ['136007.112'],
				},
				{
					name: 'SND',
					roms: ['136007.110'],
				},
				]
			},
			{
				archive_name: 'namco51',
				mappings: [
				{
					name: 'IO',
					roms: ['51xx.bin'],
				},
				]
			},
		]
	},

]

let ROM_INDEX = RomSetInfo.length-1
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+(ROM_INDEX+1))

let PRG1, PRG2, PRG3, BG2, OBJ, BG4, MAPDATA, RGB, OBJCOLOR, BGCOLOR, SND, IO;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG1       = ROM["PRG1"].addBase();
		PRG2       = ROM["PRG2"].addBase();
		PRG3       = ROM["PRG3"].addBase();
		BG2        = ROM["BG2"];
		OBJ        = ROM["OBJ"];
		BG4        = ROM["BG4"];
		MAPDATA    = ROM["MAPDATA"];
		RGB        = ROM["RGB"];
		OBJCOLOR   = ROM["OBJCOLOR"];
		BGCOLOR    = ROM["BGCOLOR"];
		
		SND        = ROM["SND"];
		IO         = ROM["IO"];
		
		game    =   new ROM.settings.driver();
		sound = new PacManSound({SND});
		
		canvas.addEventListener('click', () => game.coin(true));
		init({game, sound});
		
	})
);
 
