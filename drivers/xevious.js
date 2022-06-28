/*
 *
 *	Xevious
 *
 */
 
/* TODO:
 * 
 * ADD Super Xevious
 * ADD Battles (bootlegs)
 * 
 */




import PacManSound from '../libs/EMU.js/devices/SOUND/pac-man_sound.js';
import Namco54XX from '../libs/EMU.js/devices/SOUND/namco_54xx.js';
import {seq, rseq, convertGFX, Timer} from '../libs/EMU.js/utils.js';
import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import Z80 from '../libs/EMU.js/devices/CPU/z80.js';
import MB8840 from '../libs/EMU.js/devices/CPU/mb8840.js';
let game, sound;

class Xevious {
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
	nSolvalou = 3;
	nRank = 'NORMAL';
	nBonus = 'A';

	fInterruptEnable0 = false;
	fInterruptEnable1 = false;
	fInterruptEnable2 = false;
	fNmiEnable = 0;
	ram = new Uint8Array(0x4000).addBase();
	mmi = new Uint8Array(0x100).fill(0xff);
	mapreg = new Uint8Array(0x100);
	mapaddr = 0;
	dmactrl = 0;

	maptbl = new Uint16Array(0x8000);
	mapatr = new Uint8Array(0x8000);

	bg2 = new Uint8Array(0x8000).fill(1);
	bg4 = new Uint8Array(0x8000).fill(3);
	obj = new Uint8Array(0x20000).fill(7).fill(3, 0x10000);
	bgcolor = Uint8Array.from(seq(0x200), i => BGCOLOR_H[i] << 4 & 0x70 | BGCOLOR_L[i]);
	objcolor = Uint8Array.from(seq(0x200), i => OBJCOLOR_H[i] << 4 | OBJCOLOR_L[i]);
	rgb = Int32Array.from(seq(0x100), i => 0xff000000 | BLUE[i] * 255 / 15 << 16| GREEN[i] * 255 / 15 << 8 | RED[i] * 255 / 15);
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;
	dwScroll = 0xff;

	cpu = [new Z80(Math.floor(18432000 / 6)), new Z80(Math.floor(18432000 / 6)), new Z80(Math.floor(18432000 / 6))];
	mcu = [new MB8840(), new MB8840()];
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
			else if (range(page, 0x68)) {
				this.cpu[0].memorymap[page].base = this.mmi;
				this.cpu[0].memorymap[page].write = (addr, data) => {
					switch (addr & 0xf0) {
					case 0x00:
					case 0x10:
						return sound[0].write(addr, data);
					case 0x20:
						switch (addr & 0x0f) {
						case 0:
							return void(this.fInterruptEnable0 = (data & 1) !== 0);
						case 1:
							return void(this.fInterruptEnable1 = (data & 1) !== 0);
						case 2:
							return void(this.fInterruptEnable2 = (data & 1) !== 0);
						case 3:
							return data & 1 ? (this.cpu[1].enable(), this.cpu[2].enable()) : (this.cpu[1].disable(), this.cpu[2].disable());
						}
					}
				};
			} else if (range(page, 0x70)) {
				this.cpu[0].memorymap[page].read = () => {
					let data = 0xff;
					this.dmactrl & 1 && (data &= this.mcu[0].o, this.mcu[0].k |= 8, interrupt(this.mcu[0]));
					this.dmactrl & 4 && (data &= this.mcu[1].o, this.mcu[1].r |= 0x100, interrupt(this.mcu[1]));
					return data;
				};
				this.cpu[0].memorymap[page].write = (addr, data) => {
					this.dmactrl & 1 && (addr < 0x7005 || data !== 1) && (this.mcu[0].k = data & 7, interrupt(this.mcu[0]));
					this.dmactrl & 4 && (this.mcu[1].r = data & 15, this.mcu[1].k = data >> 4, interrupt(this.mcu[1]));
					this.dmactrl & 8 && sound[1].write(data);
				};
			} else if (range(page, 0x71)) {
				this.cpu[0].memorymap[page].read = () => { return this.dmactrl; };
				this.cpu[0].memorymap[page].write = (addr, data) => {
					this.fNmiEnable = 2 << (data >> 5) & ~3;
					switch (this.dmactrl = data) {
					case 0x71:
						if (this.mcu[0].mask & 4)
							for (this.mcu[0].execute(); this.mcu[0].pc !== 0x182; this.mcu[0].execute()) {}
						return this.mcu[0].t = this.mcu[0].t + 1 & 0xff, this.mcu[0].k |= 8, interrupt(this.mcu[0]);
					case 0x74:
						if (this.mcu[1].mask & 4)
							for (this.mcu[1].execute(); this.mcu[1].pc !== 0x4c; this.mcu[1].execute()) {}
						return this.mcu[1].r |= 0x100, interrupt(this.mcu[1]);
					}
				};
			} else if (range(page, 0x78, 0x7f)) {
				this.cpu[0].memorymap[page].base = this.ram.base[page & 7];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0x80, 0x87)) {
				this.cpu[0].memorymap[page].base = this.ram.base[8 | page & 7];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0x90, 0x97)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x10 | page & 7];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0xa0, 0xa7)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x18 | page & 7];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0xb0, 0xbf)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x20 | page & 0xf];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0xc0, 0xcf)) {
				this.cpu[0].memorymap[page].base = this.ram.base[0x30 | page & 0xf];
				this.cpu[0].memorymap[page].write = null;
			} else if (range(page, 0xd0))
				this.cpu[0].memorymap[page].write = (addr, data) => {
					switch (addr & 0xff) {
					case 0:
						return void(this.dwScroll = data);
					case 1:
						return void(this.dwScroll = data | 0x100);
					}
				};
			else if (range(page, 0xf0)) {
				this.cpu[0].memorymap[page].base = this.mapreg;
				this.cpu[0].memorymap[page].write = (addr, data) => {
					switch (addr & 0xff) {
					case 0:
						this.mapaddr = this.mapaddr & 0x7f00 | data;
						break;
					case 1:
						this.mapaddr = this.mapaddr & 0xff | data << 8 & 0x7f00;
						break;
					default:
						return;
					}
					let ptr = this.maptbl[this.mapaddr], x = this.mapatr[this.mapaddr];
					x ^= MAPDATA[ptr] >> 1 & 0x40 | MAPDATA[ptr] << 1 & 0x80;
					this.mapreg[0] = MAPDATA[ptr] & 0x3f | x;
					this.mapreg[1] = MAPDATA[0x800 + ptr];
				};
			}

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
		this.cpu[2].memorymap[0x68] = {base: this.mmi, read: null, write: (addr, data) => {
			!(addr & 0xe0) && sound[0].write(addr, data);
		}, fetch: null};

		this.mcu[0].rom.set(IO);
		this.mcu[0].r = 0xffff;
		this.mcu[1].rom.set(KEY);

		//DIPSW SETUP
		this.mmi.fill(3, 0, 8);

		////
		for (let i = 0; i < 0x80; i++)
			for (let j = 0; j < 0x100; j++) {
				const k = (i >> 1) * 0x80 + (j >> 1), l = [0, 2, 1, 3][MAPTBL[k >> 1] >> 1 + (k << 2 & 4) & 3];
				this.mapatr[i << 8 | j] = l << 6;
				this.maptbl[i << 8 | j] = (i << 1 & 2 | j & 1) ^ l | MAPTBL[k + 0x1000] << 2 | MAPTBL[k >> 1] << 10 - (k << 2 & 4) & 0x400;
			}

		//SETUP VIDEO
		convertGFX(this.bg2, BG2, 512, rseq(8, 0, 8), seq(8), [0], 8);
		convertGFX(this.bg4, BG4, 512, rseq(8, 0, 8), seq(8), [0, 0x8000], 8);
		convertGFX(this.obj, OBJ, 128, rseq(8, 256, 8).concat(rseq(8, 0, 8)),
			seq(4).concat(seq(4, 64), seq(4, 128), seq(4, 192)), [0x20004, 0, 4], 64);
		convertGFX(this.obj.subarray(0x8000), OBJ.subarray(0x2000), 128, rseq(8, 256, 8).concat(rseq(8, 0, 8)),
			seq(4).concat(seq(4, 64), seq(4, 128), seq(4, 192)), [0x10000, 0, 4], 64);
		convertGFX(this.obj.subarray(0x10000), OBJ.subarray(0x6000), 64, rseq(8, 256, 8).concat(rseq(8, 0, 8)),
			seq(4).concat(seq(4, 64), seq(4, 128), seq(4, 192)), [0, 4], 64);
	}
	
	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		
		const update = () => {this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		
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
			
			sound[0].execute(tick_rate);
			sound[1].execute(tick_rate);
			audio.execute(tick_rate);
		}
		if (this.mcu[1].mask & 4)
			for (this.mcu[1].execute(); this.mcu[1].pc !== 0x4c; this.mcu[1].execute()) {}
	}
	
	reset() {
		this.fReset = true;
	}

	updateStatus() {
		//DIP SWITCH UPDATE
		if (this.fDIPSwitchChanged) {
			this.fDIPSwitchChanged = false;
			switch (this.nSolvalou) {
			case 1:
				this.mmi[5] &= ~2, this.mmi[6] |= 2;
				break;
			case 2:
				this.mmi[5] |= 2, this.mmi[6] &= ~2;
				break;
			case 3:
				this.mmi[5] |= 2, this.mmi[6] |= 2;
				break;
			case 5:
				this.mmi[5] &= ~2, this.mmi[6] &= ~2;
				break;
			}
			switch (this.nRank) {
			case 'EASY':
				this.mmi[5] &= ~1, this.mmi[6] |= 1;
				break;
			case 'NORMAL':
				this.mmi[5] |= 1, this.mmi[6] |= 1;
				break;
			case 'HARD':
				this.mmi[5] |= 1, this.mmi[6] &= ~1;
				break;
			case 'VERY HARD':
				this.mmi[5] &= ~1, this.mmi[6] &= ~1;
				break;
			}
			switch (this.nBonus) {
			case 'A':
				this.mmi[2] |= 2, this.mmi[3] |= 2, this.mmi[4] |= 2;
				break;
			case 'B':
				this.mmi[2] &= ~2, this.mmi[3] |= 2, this.mmi[4] |= 2;
				break;
			case 'C':
				this.mmi[2] |= 2, this.mmi[3] &= ~2, this.mmi[4] |= 2;
				break;
			case 'D':
				this.mmi[2] &= ~2, this.mmi[3] &= ~2, this.mmi[4] |= 2;
				break;
			case 'E':
				this.mmi[2] |= 2, this.mmi[3] |= 2, this.mmi[4] &= ~2;
				break;
			case 'F':
				this.mmi[2] &= ~2, this.mmi[3] |= 2, this.mmi[4] &= ~2;
				break;
			case 'G':
				this.mmi[2] |= 2, this.mmi[3] &= ~2, this.mmi[4] &= ~2;
				break;
			case 'NONE':
				this.mmi[2] &= ~2, this.mmi[3] &= ~2, this.mmi[4] &= ~2;
				break;
			}
			if (!this.fTest)
				this.fReset = true;
		}

		this.mcu[0].r = this.mcu[0].r & ~0x8000 | !this.fTest << 15;

		//RESET
		if (this.fReset) {
			this.fReset = false;
			sound[1].reset();
			this.fInterruptEnable0 = this.fInterruptEnable1 = this.fInterruptEnable2 = false;
			this.fNmiEnable = 0;
			this.cpu[0].reset();
			this.cpu[1].disable();
			this.cpu[2].disable();
			this.mcu.forEach(mcu => mcu.reset());
			for (; ~this.mcu[0].mask & 4; this.mcu[0].execute()) {}
			for (; ~this.mcu[1].mask & 4; this.mcu[1].execute()) {}
		}
		return this;
	}

	updateInput() {
		this.mcu[0].r = this.mcu[0].r & ~0x4c0f | this.dwStick | !this.fCoin << 14 | !this.fStart1P << 10 | !this.fStart2P << 11;
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
		this.mcu[0].r = this.mcu[0].r & ~(1 << 8) | !fDown << 8;
	}

	triggerB(fDown) {
		this.mmi[0] = this.mmi[0] & ~(1 << 0) | !fDown << 0;
	}

	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;

		//bg4 drawing
		let p = 256 * (16 - (this.dwScroll + 4 & 7)) + 232;
		for (let k = 0x80 + ((this.dwScroll + 4 >> 3) + 2 & 0x3f), i = 0; i < 28; k = k + 27 & 0x3f | k + 0x40 & 0x7c0, p -= 256 * 8 * 37 + 8, i++)
			for (let j = 0; j < 37; k = k + 1 & 0x3f | k & 0x7c0, p += 256 * 8, j++)
				this.xfer8x8x2(this.bitmap, p, k);

		//obj drawing
		for (let k = 0xf80, i = 64; i !== 0; k += 2, --i) {
			const x = this.ram[k] + 1 & 0xff;
			const y = (this.ram[k + 1] | this.ram[k + 0x801] << 8) - 24 & 0x1ff;
			const src = this.ram[k + 0x1000] | this.ram[k + 0x800] << 1 & 0x100 | this.ram[k + 0x1001] << 9;
			switch (this.ram[k + 0x800] & 0x0f) {
			case 0x00: //normal
				this.xfer16x16(this.bitmap, x | y << 8, src);
				break;
			case 0x04: //V invert
				this.xfer16x16V(this.bitmap, x | y << 8, src);
				break;
			case 0x08: //H invert
				this.xfer16x16H(this.bitmap, x | y << 8, src);
				break;
			case 0x0c: //HV invert
				this.xfer16x16HV(this.bitmap, x | y << 8, src);
				break;
			case 0x01: //normal
				this.xfer16x16(this.bitmap, x | y << 8, src & ~1);
				this.xfer16x16(this.bitmap, x | (y + 16 & 0x1ff) << 8, src | 1);
				break;
			case 0x05: //V invert
				this.xfer16x16V(this.bitmap, x | y << 8, src | 1);
				this.xfer16x16V(this.bitmap, x | (y + 16 & 0x1ff) << 8, src & ~1);
				break;
			case 0x09: //H invert
				this.xfer16x16H(this.bitmap, x | y << 8, src & ~1);
				this.xfer16x16H(this.bitmap, x | (y + 16 & 0x1ff) << 8, src | 1);
				break;
			case 0x0d: //HV invert
				this.xfer16x16HV(this.bitmap, x | y << 8, src | 1);
				this.xfer16x16HV(this.bitmap, x | (y + 16 & 0x1ff) << 8, src & ~1);
				break;
			case 0x02: //normal
				this.xfer16x16(this.bitmap, x | y << 8, src | 2);
				this.xfer16x16(this.bitmap, (x + 16 & 0xff) | y << 8, src & ~2);
				break;
			case 0x06: //V invert
				this.xfer16x16V(this.bitmap, x | y << 8, src | 2);
				this.xfer16x16V(this.bitmap, (x + 16 & 0xff) | y << 8, src & ~2);
				break;
			case 0x0a: //H invert
				this.xfer16x16H(this.bitmap, x | y << 8, src & ~2);
				this.xfer16x16H(this.bitmap, (x + 16 & 0xff) | y << 8, src | 2);
				break;
			case 0x0e: //HV invert
				this.xfer16x16HV(this.bitmap, x | y << 8, src & ~2);
				this.xfer16x16HV(this.bitmap, (x + 16 & 0xff) | y << 8, src | 2);
				break;
			case 0x03: //normal
				this.xfer16x16(this.bitmap, x | y << 8, src & ~3 | 2);
				this.xfer16x16(this.bitmap, x | (y + 16 & 0x1ff) << 8, src | 3);
				this.xfer16x16(this.bitmap, (x + 16 & 0xff) | y << 8, src & ~3);
				this.xfer16x16(this.bitmap, (x + 16 & 0xff) | (y + 16 & 0x1ff) << 8, src & ~3 | 1);
				break;
			case 0x07: //V invert
				this.xfer16x16V(this.bitmap, x | y << 8, src | 3);
				this.xfer16x16V(this.bitmap, x | (y + 16 & 0x1ff) << 8, src & ~3 | 2);
				this.xfer16x16V(this.bitmap, (x + 16 & 0xff) | y << 8, src & ~3 | 1);
				this.xfer16x16V(this.bitmap, (x + 16 & 0xff) | (y + 16 & 0x1ff) << 8, src & ~3);
				break;
			case 0x0b: //H invert
				this.xfer16x16H(this.bitmap, x | y << 8, src & ~3);
				this.xfer16x16H(this.bitmap, x | (y + 16 & 0x1ff) << 8, src & ~3 | 1);
				this.xfer16x16H(this.bitmap, (x + 16 & 0xff) | y << 8, src & ~3 | 2);
				this.xfer16x16H(this.bitmap, (x + 16 & 0xff) | (y + 16 & 0x1ff) << 8, src | 3);
				break;
			case 0x0f: //HV invert
				this.xfer16x16HV(this.bitmap, x | y << 8, src & ~3 | 1);
				this.xfer16x16HV(this.bitmap, x | (y + 16 & 0x1ff) << 8, src & ~3);
				this.xfer16x16HV(this.bitmap, (x + 16 & 0xff) | y << 8, src | 3);
				this.xfer16x16HV(this.bitmap, (x + 16 & 0xff) | (y + 16 & 0x1ff) << 8, src & ~3 | 2);
				break;
			}
		}

		//bg2 drawing
		p = 256 * 8 * 2 + 234;
		for (let k = 0x2084, i = 0; i < 29; k += 28, p -= 256 * 8 * 36 + 8, i++)
			for (let j = 0; j < 36; k++, p += 256 * 8, j++)
				this.xfer8x8x1(this.bitmap, p, k);

		//update palette
		p = 256 * 16 + 16;
		for (let i = 0; i < 288; p += 256 - 224, i++)
			for (let j = 0; j < 224; p++, j++)
				this.bitmap[p] = this.rgb[this.bitmap[p]];

		return this.bitmap;
	}

	xfer8x8x2(data, p, k) {
		const q = (this.ram[k + 0x3800] | this.ram[k + 0x2800] << 8 & 0x100) << 6;
		const idx = this.ram[k + 0x2800] & 0x3c | this.ram[k + 0x3800] >> 1 & 0x40 | this.ram[k + 0x2800] << 7 & 0x180;

		switch (this.ram[k + 0x2800] >> 6) {
		case 0: //normal
			data[p + 0x000] = this.bgcolor[idx | this.bg4[q | 0x00]];
			data[p + 0x001] = this.bgcolor[idx | this.bg4[q | 0x01]];
			data[p + 0x002] = this.bgcolor[idx | this.bg4[q | 0x02]];
			data[p + 0x003] = this.bgcolor[idx | this.bg4[q | 0x03]];
			data[p + 0x004] = this.bgcolor[idx | this.bg4[q | 0x04]];
			data[p + 0x005] = this.bgcolor[idx | this.bg4[q | 0x05]];
			data[p + 0x006] = this.bgcolor[idx | this.bg4[q | 0x06]];
			data[p + 0x007] = this.bgcolor[idx | this.bg4[q | 0x07]];
			data[p + 0x100] = this.bgcolor[idx | this.bg4[q | 0x08]];
			data[p + 0x101] = this.bgcolor[idx | this.bg4[q | 0x09]];
			data[p + 0x102] = this.bgcolor[idx | this.bg4[q | 0x0a]];
			data[p + 0x103] = this.bgcolor[idx | this.bg4[q | 0x0b]];
			data[p + 0x104] = this.bgcolor[idx | this.bg4[q | 0x0c]];
			data[p + 0x105] = this.bgcolor[idx | this.bg4[q | 0x0d]];
			data[p + 0x106] = this.bgcolor[idx | this.bg4[q | 0x0e]];
			data[p + 0x107] = this.bgcolor[idx | this.bg4[q | 0x0f]];
			data[p + 0x200] = this.bgcolor[idx | this.bg4[q | 0x10]];
			data[p + 0x201] = this.bgcolor[idx | this.bg4[q | 0x11]];
			data[p + 0x202] = this.bgcolor[idx | this.bg4[q | 0x12]];
			data[p + 0x203] = this.bgcolor[idx | this.bg4[q | 0x13]];
			data[p + 0x204] = this.bgcolor[idx | this.bg4[q | 0x14]];
			data[p + 0x205] = this.bgcolor[idx | this.bg4[q | 0x15]];
			data[p + 0x206] = this.bgcolor[idx | this.bg4[q | 0x16]];
			data[p + 0x207] = this.bgcolor[idx | this.bg4[q | 0x17]];
			data[p + 0x300] = this.bgcolor[idx | this.bg4[q | 0x18]];
			data[p + 0x301] = this.bgcolor[idx | this.bg4[q | 0x19]];
			data[p + 0x302] = this.bgcolor[idx | this.bg4[q | 0x1a]];
			data[p + 0x303] = this.bgcolor[idx | this.bg4[q | 0x1b]];
			data[p + 0x304] = this.bgcolor[idx | this.bg4[q | 0x1c]];
			data[p + 0x305] = this.bgcolor[idx | this.bg4[q | 0x1d]];
			data[p + 0x306] = this.bgcolor[idx | this.bg4[q | 0x1e]];
			data[p + 0x307] = this.bgcolor[idx | this.bg4[q | 0x1f]];
			data[p + 0x400] = this.bgcolor[idx | this.bg4[q | 0x20]];
			data[p + 0x401] = this.bgcolor[idx | this.bg4[q | 0x21]];
			data[p + 0x402] = this.bgcolor[idx | this.bg4[q | 0x22]];
			data[p + 0x403] = this.bgcolor[idx | this.bg4[q | 0x23]];
			data[p + 0x404] = this.bgcolor[idx | this.bg4[q | 0x24]];
			data[p + 0x405] = this.bgcolor[idx | this.bg4[q | 0x25]];
			data[p + 0x406] = this.bgcolor[idx | this.bg4[q | 0x26]];
			data[p + 0x407] = this.bgcolor[idx | this.bg4[q | 0x27]];
			data[p + 0x500] = this.bgcolor[idx | this.bg4[q | 0x28]];
			data[p + 0x501] = this.bgcolor[idx | this.bg4[q | 0x29]];
			data[p + 0x502] = this.bgcolor[idx | this.bg4[q | 0x2a]];
			data[p + 0x503] = this.bgcolor[idx | this.bg4[q | 0x2b]];
			data[p + 0x504] = this.bgcolor[idx | this.bg4[q | 0x2c]];
			data[p + 0x505] = this.bgcolor[idx | this.bg4[q | 0x2d]];
			data[p + 0x506] = this.bgcolor[idx | this.bg4[q | 0x2e]];
			data[p + 0x507] = this.bgcolor[idx | this.bg4[q | 0x2f]];
			data[p + 0x600] = this.bgcolor[idx | this.bg4[q | 0x30]];
			data[p + 0x601] = this.bgcolor[idx | this.bg4[q | 0x31]];
			data[p + 0x602] = this.bgcolor[idx | this.bg4[q | 0x32]];
			data[p + 0x603] = this.bgcolor[idx | this.bg4[q | 0x33]];
			data[p + 0x604] = this.bgcolor[idx | this.bg4[q | 0x34]];
			data[p + 0x605] = this.bgcolor[idx | this.bg4[q | 0x35]];
			data[p + 0x606] = this.bgcolor[idx | this.bg4[q | 0x36]];
			data[p + 0x607] = this.bgcolor[idx | this.bg4[q | 0x37]];
			data[p + 0x700] = this.bgcolor[idx | this.bg4[q | 0x38]];
			data[p + 0x701] = this.bgcolor[idx | this.bg4[q | 0x39]];
			data[p + 0x702] = this.bgcolor[idx | this.bg4[q | 0x3a]];
			data[p + 0x703] = this.bgcolor[idx | this.bg4[q | 0x3b]];
			data[p + 0x704] = this.bgcolor[idx | this.bg4[q | 0x3c]];
			data[p + 0x705] = this.bgcolor[idx | this.bg4[q | 0x3d]];
			data[p + 0x706] = this.bgcolor[idx | this.bg4[q | 0x3e]];
			data[p + 0x707] = this.bgcolor[idx | this.bg4[q | 0x3f]];
			break;
		case 1: //V invert
			data[p + 0x000] = this.bgcolor[idx | this.bg4[q | 0x38]];
			data[p + 0x001] = this.bgcolor[idx | this.bg4[q | 0x39]];
			data[p + 0x002] = this.bgcolor[idx | this.bg4[q | 0x3a]];
			data[p + 0x003] = this.bgcolor[idx | this.bg4[q | 0x3b]];
			data[p + 0x004] = this.bgcolor[idx | this.bg4[q | 0x3c]];
			data[p + 0x005] = this.bgcolor[idx | this.bg4[q | 0x3d]];
			data[p + 0x006] = this.bgcolor[idx | this.bg4[q | 0x3e]];
			data[p + 0x007] = this.bgcolor[idx | this.bg4[q | 0x3f]];
			data[p + 0x100] = this.bgcolor[idx | this.bg4[q | 0x30]];
			data[p + 0x101] = this.bgcolor[idx | this.bg4[q | 0x31]];
			data[p + 0x102] = this.bgcolor[idx | this.bg4[q | 0x32]];
			data[p + 0x103] = this.bgcolor[idx | this.bg4[q | 0x33]];
			data[p + 0x104] = this.bgcolor[idx | this.bg4[q | 0x34]];
			data[p + 0x105] = this.bgcolor[idx | this.bg4[q | 0x35]];
			data[p + 0x106] = this.bgcolor[idx | this.bg4[q | 0x36]];
			data[p + 0x107] = this.bgcolor[idx | this.bg4[q | 0x37]];
			data[p + 0x200] = this.bgcolor[idx | this.bg4[q | 0x28]];
			data[p + 0x201] = this.bgcolor[idx | this.bg4[q | 0x29]];
			data[p + 0x202] = this.bgcolor[idx | this.bg4[q | 0x2a]];
			data[p + 0x203] = this.bgcolor[idx | this.bg4[q | 0x2b]];
			data[p + 0x204] = this.bgcolor[idx | this.bg4[q | 0x2c]];
			data[p + 0x205] = this.bgcolor[idx | this.bg4[q | 0x2d]];
			data[p + 0x206] = this.bgcolor[idx | this.bg4[q | 0x2e]];
			data[p + 0x207] = this.bgcolor[idx | this.bg4[q | 0x2f]];
			data[p + 0x300] = this.bgcolor[idx | this.bg4[q | 0x20]];
			data[p + 0x301] = this.bgcolor[idx | this.bg4[q | 0x21]];
			data[p + 0x302] = this.bgcolor[idx | this.bg4[q | 0x22]];
			data[p + 0x303] = this.bgcolor[idx | this.bg4[q | 0x23]];
			data[p + 0x304] = this.bgcolor[idx | this.bg4[q | 0x24]];
			data[p + 0x305] = this.bgcolor[idx | this.bg4[q | 0x25]];
			data[p + 0x306] = this.bgcolor[idx | this.bg4[q | 0x26]];
			data[p + 0x307] = this.bgcolor[idx | this.bg4[q | 0x27]];
			data[p + 0x400] = this.bgcolor[idx | this.bg4[q | 0x18]];
			data[p + 0x401] = this.bgcolor[idx | this.bg4[q | 0x19]];
			data[p + 0x402] = this.bgcolor[idx | this.bg4[q | 0x1a]];
			data[p + 0x403] = this.bgcolor[idx | this.bg4[q | 0x1b]];
			data[p + 0x404] = this.bgcolor[idx | this.bg4[q | 0x1c]];
			data[p + 0x405] = this.bgcolor[idx | this.bg4[q | 0x1d]];
			data[p + 0x406] = this.bgcolor[idx | this.bg4[q | 0x1e]];
			data[p + 0x407] = this.bgcolor[idx | this.bg4[q | 0x1f]];
			data[p + 0x500] = this.bgcolor[idx | this.bg4[q | 0x10]];
			data[p + 0x501] = this.bgcolor[idx | this.bg4[q | 0x11]];
			data[p + 0x502] = this.bgcolor[idx | this.bg4[q | 0x12]];
			data[p + 0x503] = this.bgcolor[idx | this.bg4[q | 0x13]];
			data[p + 0x504] = this.bgcolor[idx | this.bg4[q | 0x14]];
			data[p + 0x505] = this.bgcolor[idx | this.bg4[q | 0x15]];
			data[p + 0x506] = this.bgcolor[idx | this.bg4[q | 0x16]];
			data[p + 0x507] = this.bgcolor[idx | this.bg4[q | 0x17]];
			data[p + 0x600] = this.bgcolor[idx | this.bg4[q | 0x08]];
			data[p + 0x601] = this.bgcolor[idx | this.bg4[q | 0x09]];
			data[p + 0x602] = this.bgcolor[idx | this.bg4[q | 0x0a]];
			data[p + 0x603] = this.bgcolor[idx | this.bg4[q | 0x0b]];
			data[p + 0x604] = this.bgcolor[idx | this.bg4[q | 0x0c]];
			data[p + 0x605] = this.bgcolor[idx | this.bg4[q | 0x0d]];
			data[p + 0x606] = this.bgcolor[idx | this.bg4[q | 0x0e]];
			data[p + 0x607] = this.bgcolor[idx | this.bg4[q | 0x0f]];
			data[p + 0x700] = this.bgcolor[idx | this.bg4[q | 0x00]];
			data[p + 0x701] = this.bgcolor[idx | this.bg4[q | 0x01]];
			data[p + 0x702] = this.bgcolor[idx | this.bg4[q | 0x02]];
			data[p + 0x703] = this.bgcolor[idx | this.bg4[q | 0x03]];
			data[p + 0x704] = this.bgcolor[idx | this.bg4[q | 0x04]];
			data[p + 0x705] = this.bgcolor[idx | this.bg4[q | 0x05]];
			data[p + 0x706] = this.bgcolor[idx | this.bg4[q | 0x06]];
			data[p + 0x707] = this.bgcolor[idx | this.bg4[q | 0x07]];
			break;
		case 2: //H invert
			data[p + 0x000] = this.bgcolor[idx | this.bg4[q | 0x07]];
			data[p + 0x001] = this.bgcolor[idx | this.bg4[q | 0x06]];
			data[p + 0x002] = this.bgcolor[idx | this.bg4[q | 0x05]];
			data[p + 0x003] = this.bgcolor[idx | this.bg4[q | 0x04]];
			data[p + 0x004] = this.bgcolor[idx | this.bg4[q | 0x03]];
			data[p + 0x005] = this.bgcolor[idx | this.bg4[q | 0x02]];
			data[p + 0x006] = this.bgcolor[idx | this.bg4[q | 0x01]];
			data[p + 0x007] = this.bgcolor[idx | this.bg4[q | 0x00]];
			data[p + 0x100] = this.bgcolor[idx | this.bg4[q | 0x0f]];
			data[p + 0x101] = this.bgcolor[idx | this.bg4[q | 0x0e]];
			data[p + 0x102] = this.bgcolor[idx | this.bg4[q | 0x0d]];
			data[p + 0x103] = this.bgcolor[idx | this.bg4[q | 0x0c]];
			data[p + 0x104] = this.bgcolor[idx | this.bg4[q | 0x0b]];
			data[p + 0x105] = this.bgcolor[idx | this.bg4[q | 0x0a]];
			data[p + 0x106] = this.bgcolor[idx | this.bg4[q | 0x09]];
			data[p + 0x107] = this.bgcolor[idx | this.bg4[q | 0x08]];
			data[p + 0x200] = this.bgcolor[idx | this.bg4[q | 0x17]];
			data[p + 0x201] = this.bgcolor[idx | this.bg4[q | 0x16]];
			data[p + 0x202] = this.bgcolor[idx | this.bg4[q | 0x15]];
			data[p + 0x203] = this.bgcolor[idx | this.bg4[q | 0x14]];
			data[p + 0x204] = this.bgcolor[idx | this.bg4[q | 0x13]];
			data[p + 0x205] = this.bgcolor[idx | this.bg4[q | 0x12]];
			data[p + 0x206] = this.bgcolor[idx | this.bg4[q | 0x11]];
			data[p + 0x207] = this.bgcolor[idx | this.bg4[q | 0x10]];
			data[p + 0x300] = this.bgcolor[idx | this.bg4[q | 0x1f]];
			data[p + 0x301] = this.bgcolor[idx | this.bg4[q | 0x1e]];
			data[p + 0x302] = this.bgcolor[idx | this.bg4[q | 0x1d]];
			data[p + 0x303] = this.bgcolor[idx | this.bg4[q | 0x1c]];
			data[p + 0x304] = this.bgcolor[idx | this.bg4[q | 0x1b]];
			data[p + 0x305] = this.bgcolor[idx | this.bg4[q | 0x1a]];
			data[p + 0x306] = this.bgcolor[idx | this.bg4[q | 0x19]];
			data[p + 0x307] = this.bgcolor[idx | this.bg4[q | 0x18]];
			data[p + 0x400] = this.bgcolor[idx | this.bg4[q | 0x27]];
			data[p + 0x401] = this.bgcolor[idx | this.bg4[q | 0x26]];
			data[p + 0x402] = this.bgcolor[idx | this.bg4[q | 0x25]];
			data[p + 0x403] = this.bgcolor[idx | this.bg4[q | 0x24]];
			data[p + 0x404] = this.bgcolor[idx | this.bg4[q | 0x23]];
			data[p + 0x405] = this.bgcolor[idx | this.bg4[q | 0x22]];
			data[p + 0x406] = this.bgcolor[idx | this.bg4[q | 0x21]];
			data[p + 0x407] = this.bgcolor[idx | this.bg4[q | 0x20]];
			data[p + 0x500] = this.bgcolor[idx | this.bg4[q | 0x2f]];
			data[p + 0x501] = this.bgcolor[idx | this.bg4[q | 0x2e]];
			data[p + 0x502] = this.bgcolor[idx | this.bg4[q | 0x2d]];
			data[p + 0x503] = this.bgcolor[idx | this.bg4[q | 0x2c]];
			data[p + 0x504] = this.bgcolor[idx | this.bg4[q | 0x2b]];
			data[p + 0x505] = this.bgcolor[idx | this.bg4[q | 0x2a]];
			data[p + 0x506] = this.bgcolor[idx | this.bg4[q | 0x29]];
			data[p + 0x507] = this.bgcolor[idx | this.bg4[q | 0x28]];
			data[p + 0x600] = this.bgcolor[idx | this.bg4[q | 0x37]];
			data[p + 0x601] = this.bgcolor[idx | this.bg4[q | 0x36]];
			data[p + 0x602] = this.bgcolor[idx | this.bg4[q | 0x35]];
			data[p + 0x603] = this.bgcolor[idx | this.bg4[q | 0x34]];
			data[p + 0x604] = this.bgcolor[idx | this.bg4[q | 0x33]];
			data[p + 0x605] = this.bgcolor[idx | this.bg4[q | 0x32]];
			data[p + 0x606] = this.bgcolor[idx | this.bg4[q | 0x31]];
			data[p + 0x607] = this.bgcolor[idx | this.bg4[q | 0x30]];
			data[p + 0x700] = this.bgcolor[idx | this.bg4[q | 0x3f]];
			data[p + 0x701] = this.bgcolor[idx | this.bg4[q | 0x3e]];
			data[p + 0x702] = this.bgcolor[idx | this.bg4[q | 0x3d]];
			data[p + 0x703] = this.bgcolor[idx | this.bg4[q | 0x3c]];
			data[p + 0x704] = this.bgcolor[idx | this.bg4[q | 0x3b]];
			data[p + 0x705] = this.bgcolor[idx | this.bg4[q | 0x3a]];
			data[p + 0x706] = this.bgcolor[idx | this.bg4[q | 0x39]];
			data[p + 0x707] = this.bgcolor[idx | this.bg4[q | 0x38]];
			break;
		case 3: //HV invert
			data[p + 0x000] = this.bgcolor[idx | this.bg4[q | 0x3f]];
			data[p + 0x001] = this.bgcolor[idx | this.bg4[q | 0x3e]];
			data[p + 0x002] = this.bgcolor[idx | this.bg4[q | 0x3d]];
			data[p + 0x003] = this.bgcolor[idx | this.bg4[q | 0x3c]];
			data[p + 0x004] = this.bgcolor[idx | this.bg4[q | 0x3b]];
			data[p + 0x005] = this.bgcolor[idx | this.bg4[q | 0x3a]];
			data[p + 0x006] = this.bgcolor[idx | this.bg4[q | 0x39]];
			data[p + 0x007] = this.bgcolor[idx | this.bg4[q | 0x38]];
			data[p + 0x100] = this.bgcolor[idx | this.bg4[q | 0x37]];
			data[p + 0x101] = this.bgcolor[idx | this.bg4[q | 0x36]];
			data[p + 0x102] = this.bgcolor[idx | this.bg4[q | 0x35]];
			data[p + 0x103] = this.bgcolor[idx | this.bg4[q | 0x34]];
			data[p + 0x104] = this.bgcolor[idx | this.bg4[q | 0x33]];
			data[p + 0x105] = this.bgcolor[idx | this.bg4[q | 0x32]];
			data[p + 0x106] = this.bgcolor[idx | this.bg4[q | 0x31]];
			data[p + 0x107] = this.bgcolor[idx | this.bg4[q | 0x30]];
			data[p + 0x200] = this.bgcolor[idx | this.bg4[q | 0x2f]];
			data[p + 0x201] = this.bgcolor[idx | this.bg4[q | 0x2e]];
			data[p + 0x202] = this.bgcolor[idx | this.bg4[q | 0x2d]];
			data[p + 0x203] = this.bgcolor[idx | this.bg4[q | 0x2c]];
			data[p + 0x204] = this.bgcolor[idx | this.bg4[q | 0x2b]];
			data[p + 0x205] = this.bgcolor[idx | this.bg4[q | 0x2a]];
			data[p + 0x206] = this.bgcolor[idx | this.bg4[q | 0x29]];
			data[p + 0x207] = this.bgcolor[idx | this.bg4[q | 0x28]];
			data[p + 0x300] = this.bgcolor[idx | this.bg4[q | 0x27]];
			data[p + 0x301] = this.bgcolor[idx | this.bg4[q | 0x26]];
			data[p + 0x302] = this.bgcolor[idx | this.bg4[q | 0x25]];
			data[p + 0x303] = this.bgcolor[idx | this.bg4[q | 0x24]];
			data[p + 0x304] = this.bgcolor[idx | this.bg4[q | 0x23]];
			data[p + 0x305] = this.bgcolor[idx | this.bg4[q | 0x22]];
			data[p + 0x306] = this.bgcolor[idx | this.bg4[q | 0x21]];
			data[p + 0x307] = this.bgcolor[idx | this.bg4[q | 0x20]];
			data[p + 0x400] = this.bgcolor[idx | this.bg4[q | 0x1f]];
			data[p + 0x401] = this.bgcolor[idx | this.bg4[q | 0x1e]];
			data[p + 0x402] = this.bgcolor[idx | this.bg4[q | 0x1d]];
			data[p + 0x403] = this.bgcolor[idx | this.bg4[q | 0x1c]];
			data[p + 0x404] = this.bgcolor[idx | this.bg4[q | 0x1b]];
			data[p + 0x405] = this.bgcolor[idx | this.bg4[q | 0x1a]];
			data[p + 0x406] = this.bgcolor[idx | this.bg4[q | 0x19]];
			data[p + 0x407] = this.bgcolor[idx | this.bg4[q | 0x18]];
			data[p + 0x500] = this.bgcolor[idx | this.bg4[q | 0x17]];
			data[p + 0x501] = this.bgcolor[idx | this.bg4[q | 0x16]];
			data[p + 0x502] = this.bgcolor[idx | this.bg4[q | 0x15]];
			data[p + 0x503] = this.bgcolor[idx | this.bg4[q | 0x14]];
			data[p + 0x504] = this.bgcolor[idx | this.bg4[q | 0x13]];
			data[p + 0x505] = this.bgcolor[idx | this.bg4[q | 0x12]];
			data[p + 0x506] = this.bgcolor[idx | this.bg4[q | 0x11]];
			data[p + 0x507] = this.bgcolor[idx | this.bg4[q | 0x10]];
			data[p + 0x600] = this.bgcolor[idx | this.bg4[q | 0x0f]];
			data[p + 0x601] = this.bgcolor[idx | this.bg4[q | 0x0e]];
			data[p + 0x602] = this.bgcolor[idx | this.bg4[q | 0x0d]];
			data[p + 0x603] = this.bgcolor[idx | this.bg4[q | 0x0c]];
			data[p + 0x604] = this.bgcolor[idx | this.bg4[q | 0x0b]];
			data[p + 0x605] = this.bgcolor[idx | this.bg4[q | 0x0a]];
			data[p + 0x606] = this.bgcolor[idx | this.bg4[q | 0x09]];
			data[p + 0x607] = this.bgcolor[idx | this.bg4[q | 0x08]];
			data[p + 0x700] = this.bgcolor[idx | this.bg4[q | 0x07]];
			data[p + 0x701] = this.bgcolor[idx | this.bg4[q | 0x06]];
			data[p + 0x702] = this.bgcolor[idx | this.bg4[q | 0x05]];
			data[p + 0x703] = this.bgcolor[idx | this.bg4[q | 0x04]];
			data[p + 0x704] = this.bgcolor[idx | this.bg4[q | 0x03]];
			data[p + 0x705] = this.bgcolor[idx | this.bg4[q | 0x02]];
			data[p + 0x706] = this.bgcolor[idx | this.bg4[q | 0x01]];
			data[p + 0x707] = this.bgcolor[idx | this.bg4[q | 0x00]];
			break;
		}
	}

	xfer8x8x1(data, p, k) {
		const q = (this.ram[k + 0x1000] | this.ram[k] << 2 & 0x100) << 6;
		const color = this.ram[k] >> 2 & 0xf | this.ram[k] << 4 & 0x30;

		switch (this.ram[k] >> 7) {
		case 0: //normal
			this.bg2[q | 0x00] && (data[p + 0x000] = color);
			this.bg2[q | 0x01] && (data[p + 0x001] = color);
			this.bg2[q | 0x02] && (data[p + 0x002] = color);
			this.bg2[q | 0x03] && (data[p + 0x003] = color);
			this.bg2[q | 0x04] && (data[p + 0x004] = color);
			this.bg2[q | 0x05] && (data[p + 0x005] = color);
			this.bg2[q | 0x06] && (data[p + 0x006] = color);
			this.bg2[q | 0x07] && (data[p + 0x007] = color);
			this.bg2[q | 0x08] && (data[p + 0x100] = color);
			this.bg2[q | 0x09] && (data[p + 0x101] = color);
			this.bg2[q | 0x0a] && (data[p + 0x102] = color);
			this.bg2[q | 0x0b] && (data[p + 0x103] = color);
			this.bg2[q | 0x0c] && (data[p + 0x104] = color);
			this.bg2[q | 0x0d] && (data[p + 0x105] = color);
			this.bg2[q | 0x0e] && (data[p + 0x106] = color);
			this.bg2[q | 0x0f] && (data[p + 0x107] = color);
			this.bg2[q | 0x10] && (data[p + 0x200] = color);
			this.bg2[q | 0x11] && (data[p + 0x201] = color);
			this.bg2[q | 0x12] && (data[p + 0x202] = color);
			this.bg2[q | 0x13] && (data[p + 0x203] = color);
			this.bg2[q | 0x14] && (data[p + 0x204] = color);
			this.bg2[q | 0x15] && (data[p + 0x205] = color);
			this.bg2[q | 0x16] && (data[p + 0x206] = color);
			this.bg2[q | 0x17] && (data[p + 0x207] = color);
			this.bg2[q | 0x18] && (data[p + 0x300] = color);
			this.bg2[q | 0x19] && (data[p + 0x301] = color);
			this.bg2[q | 0x1a] && (data[p + 0x302] = color);
			this.bg2[q | 0x1b] && (data[p + 0x303] = color);
			this.bg2[q | 0x1c] && (data[p + 0x304] = color);
			this.bg2[q | 0x1d] && (data[p + 0x305] = color);
			this.bg2[q | 0x1e] && (data[p + 0x306] = color);
			this.bg2[q | 0x1f] && (data[p + 0x307] = color);
			this.bg2[q | 0x20] && (data[p + 0x400] = color);
			this.bg2[q | 0x21] && (data[p + 0x401] = color);
			this.bg2[q | 0x22] && (data[p + 0x402] = color);
			this.bg2[q | 0x23] && (data[p + 0x403] = color);
			this.bg2[q | 0x24] && (data[p + 0x404] = color);
			this.bg2[q | 0x25] && (data[p + 0x405] = color);
			this.bg2[q | 0x26] && (data[p + 0x406] = color);
			this.bg2[q | 0x27] && (data[p + 0x407] = color);
			this.bg2[q | 0x28] && (data[p + 0x500] = color);
			this.bg2[q | 0x29] && (data[p + 0x501] = color);
			this.bg2[q | 0x2a] && (data[p + 0x502] = color);
			this.bg2[q | 0x2b] && (data[p + 0x503] = color);
			this.bg2[q | 0x2c] && (data[p + 0x504] = color);
			this.bg2[q | 0x2d] && (data[p + 0x505] = color);
			this.bg2[q | 0x2e] && (data[p + 0x506] = color);
			this.bg2[q | 0x2f] && (data[p + 0x507] = color);
			this.bg2[q | 0x30] && (data[p + 0x600] = color);
			this.bg2[q | 0x31] && (data[p + 0x601] = color);
			this.bg2[q | 0x32] && (data[p + 0x602] = color);
			this.bg2[q | 0x33] && (data[p + 0x603] = color);
			this.bg2[q | 0x34] && (data[p + 0x604] = color);
			this.bg2[q | 0x35] && (data[p + 0x605] = color);
			this.bg2[q | 0x36] && (data[p + 0x606] = color);
			this.bg2[q | 0x37] && (data[p + 0x607] = color);
			this.bg2[q | 0x38] && (data[p + 0x700] = color);
			this.bg2[q | 0x39] && (data[p + 0x701] = color);
			this.bg2[q | 0x3a] && (data[p + 0x702] = color);
			this.bg2[q | 0x3b] && (data[p + 0x703] = color);
			this.bg2[q | 0x3c] && (data[p + 0x704] = color);
			this.bg2[q | 0x3d] && (data[p + 0x705] = color);
			this.bg2[q | 0x3e] && (data[p + 0x706] = color);
			this.bg2[q | 0x3f] && (data[p + 0x707] = color);
			break;
		case 1: //H invert
			this.bg2[q | 0x07] && (data[p + 0x000] = color);
			this.bg2[q | 0x06] && (data[p + 0x001] = color);
			this.bg2[q | 0x05] && (data[p + 0x002] = color);
			this.bg2[q | 0x04] && (data[p + 0x003] = color);
			this.bg2[q | 0x03] && (data[p + 0x004] = color);
			this.bg2[q | 0x02] && (data[p + 0x005] = color);
			this.bg2[q | 0x01] && (data[p + 0x006] = color);
			this.bg2[q | 0x00] && (data[p + 0x007] = color);
			this.bg2[q | 0x0f] && (data[p + 0x100] = color);
			this.bg2[q | 0x0e] && (data[p + 0x101] = color);
			this.bg2[q | 0x0d] && (data[p + 0x102] = color);
			this.bg2[q | 0x0c] && (data[p + 0x103] = color);
			this.bg2[q | 0x0b] && (data[p + 0x104] = color);
			this.bg2[q | 0x0a] && (data[p + 0x105] = color);
			this.bg2[q | 0x09] && (data[p + 0x106] = color);
			this.bg2[q | 0x08] && (data[p + 0x107] = color);
			this.bg2[q | 0x17] && (data[p + 0x200] = color);
			this.bg2[q | 0x16] && (data[p + 0x201] = color);
			this.bg2[q | 0x15] && (data[p + 0x202] = color);
			this.bg2[q | 0x14] && (data[p + 0x203] = color);
			this.bg2[q | 0x13] && (data[p + 0x204] = color);
			this.bg2[q | 0x12] && (data[p + 0x205] = color);
			this.bg2[q | 0x11] && (data[p + 0x206] = color);
			this.bg2[q | 0x10] && (data[p + 0x207] = color);
			this.bg2[q | 0x1f] && (data[p + 0x300] = color);
			this.bg2[q | 0x1e] && (data[p + 0x301] = color);
			this.bg2[q | 0x1d] && (data[p + 0x302] = color);
			this.bg2[q | 0x1c] && (data[p + 0x303] = color);
			this.bg2[q | 0x1b] && (data[p + 0x304] = color);
			this.bg2[q | 0x1a] && (data[p + 0x305] = color);
			this.bg2[q | 0x19] && (data[p + 0x306] = color);
			this.bg2[q | 0x18] && (data[p + 0x307] = color);
			this.bg2[q | 0x27] && (data[p + 0x400] = color);
			this.bg2[q | 0x26] && (data[p + 0x401] = color);
			this.bg2[q | 0x25] && (data[p + 0x402] = color);
			this.bg2[q | 0x24] && (data[p + 0x403] = color);
			this.bg2[q | 0x23] && (data[p + 0x404] = color);
			this.bg2[q | 0x22] && (data[p + 0x405] = color);
			this.bg2[q | 0x21] && (data[p + 0x406] = color);
			this.bg2[q | 0x20] && (data[p + 0x407] = color);
			this.bg2[q | 0x2f] && (data[p + 0x500] = color);
			this.bg2[q | 0x2e] && (data[p + 0x501] = color);
			this.bg2[q | 0x2d] && (data[p + 0x502] = color);
			this.bg2[q | 0x2c] && (data[p + 0x503] = color);
			this.bg2[q | 0x2b] && (data[p + 0x504] = color);
			this.bg2[q | 0x2a] && (data[p + 0x505] = color);
			this.bg2[q | 0x29] && (data[p + 0x506] = color);
			this.bg2[q | 0x28] && (data[p + 0x507] = color);
			this.bg2[q | 0x37] && (data[p + 0x600] = color);
			this.bg2[q | 0x36] && (data[p + 0x601] = color);
			this.bg2[q | 0x35] && (data[p + 0x602] = color);
			this.bg2[q | 0x34] && (data[p + 0x603] = color);
			this.bg2[q | 0x33] && (data[p + 0x604] = color);
			this.bg2[q | 0x32] && (data[p + 0x605] = color);
			this.bg2[q | 0x31] && (data[p + 0x606] = color);
			this.bg2[q | 0x30] && (data[p + 0x607] = color);
			this.bg2[q | 0x3f] && (data[p + 0x700] = color);
			this.bg2[q | 0x3e] && (data[p + 0x701] = color);
			this.bg2[q | 0x3d] && (data[p + 0x702] = color);
			this.bg2[q | 0x3c] && (data[p + 0x703] = color);
			this.bg2[q | 0x3b] && (data[p + 0x704] = color);
			this.bg2[q | 0x3a] && (data[p + 0x705] = color);
			this.bg2[q | 0x39] && (data[p + 0x706] = color);
			this.bg2[q | 0x38] && (data[p + 0x707] = color);
			break;
		}
	}

	xfer16x16(data, dst, src) {
		const idx = src >> 6 & 0x1f8;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 304 * 0x100)
			return;
		src = src << 8 & 0x1ff00;
		for (let i = 16; i !== 0; dst += 256 - 16, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.objcolor[idx | this.obj[src++]]) & 0x80)
					data[dst] = px & 0x7f;
	}

	xfer16x16V(data, dst, src) {
		const idx = src >> 6 & 0x1f8;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 304 * 0x100)
			return;
		src = (src << 8 & 0x1ff00) + 256 - 16;
		for (let i = 16; i !== 0; dst += 256 - 16, src -= 32, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.objcolor[idx | this.obj[src++]]) & 0x80)
					data[dst] = px & 0x7f;
	}

	xfer16x16H(data, dst, src) {
		const idx = src >> 6 & 0x1f8;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 304 * 0x100)
			return;
		src = (src << 8 & 0x1ff00) + 16;
		for (let i = 16; i !== 0; dst += 256 - 16, src += 32, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.objcolor[idx | this.obj[--src]]) & 0x80)
					data[dst] = px & 0x7f;
	}

	xfer16x16HV(data, dst, src) {
		const idx = src >> 6 & 0x1f8;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 304 * 0x100)
			return;
		src = (src << 8 & 0x1ff00) + 256;
		for (let i = 16; i !== 0; dst += 256 - 16, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.objcolor[idx | this.obj[--src]]) & 0x80)
					data[dst] = px & 0x7f;
	}
}

/*
 *
 *	Super Xevious
 *
 */

class SuperXevious extends Xevious {
	
	updateInput() {
		//this.mcu[0].r = this.mcu[0].r & ~0x4c0f | this.dwStick | !this.fCoin << 14 | !this.fStart1P << 10 | !this.fStart2P << 11;
		
		//this.mcu[0].r |= 0x8000;
		this.mcu[0].r = 0x8080
		
		//this.fCoin -= !!this.fCoin, this.fStart1P -= !!this.fStart1P, this.fStart2P -= !!this.fStart2P;
		return this;
	}
}

/*
 *
 *	Xevious
 *
 */

const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		// Mame name  'xevious'
		display_name: 'Xevious (Namco)',
		developer: 'Namco',
		year: '1982',
		Notes: '',

		driver: Xevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['xvi_1.3p','xvi_2.3m','xvi_3.2m','xvi_4.2l'],
				},
				{
					name: 'PRG2',
					roms: ['xvi_5.3f','xvi_6.3j'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'xeviousa'
		display_name: 'Xevious (Atari, harder)',
		developer: 'Namco (Atari license)',
		year: '1982',
		Notes: '',

		driver: Xevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['xea-1m-a.bin','xea-1l-a.bin'],
				},
				{
					name: 'PRG2',
					roms: ['xea-4c-a.bin'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'xeviousb'
		display_name: 'Xevious (Atari)',
		developer: 'Namco (Atari license)',
		year: '1982',
		Notes: '',

		driver: Xevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['1m.bin','1l.bin'],
				},
				{
					name: 'PRG2',
					roms: ['4c.bin'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'xeviousc'
		display_name: 'Xevious (Atari, Namco PCB)',
		developer: 'Namco (Atari license)',
		year: '1982',
		Notes: '',

		driver: Xevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['xvi_u_.3p','xv_2-2.3m','xv_2-3.2m','xvi_u_.2l'],
				},
				{
					name: 'PRG2',
					roms: ['xv2_5.3f','xvi_6.3j'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'sxevious'
		display_name: 'Super Xevious',
		developer: 'Namco',
		year: '1984',
		Notes: 'FAILS TO BOOT',

		driver: SuperXevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['cpu_3p.rom','cpu_3m.rom','xv3_3.2m','xv3_4.2l'],
				},
				{
					name: 'PRG2',
					roms: ['xv3_5.3f','xv3_6.3j'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'sxeviousj'
		display_name: 'Super Xevious (Japan)',
		developer: 'Namco',
		year: '1984',
		Notes: 'FAILS TO BOOT',

		driver: SuperXevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					roms: ['xv3_1.3p','xv3_2.3m','xv3_3.2m','xv3_4.2l'],
				},
				{
					name: 'PRG2',
					roms: ['xv3_5.3f','xv3_6.3j'],
				},
				{
					name: 'PRG3',
					roms: ['xvi_7.2c'],
				},
				{
					name: 'BG2',
					roms: ['xvi_12.3b'],
				},
				{
					name: 'BG4',
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					roms: ['xvi_15.4m','xvi_17.4p','xvi_16.4n','xvi_18.4r'],
				},
				{
					name: 'MAPTBL',
					roms: ['xvi_9.2a','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['xvi_11.2c'],
				},
				{
					name: 'RED',
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
	{
		// Mame name  'xevios'
		display_name: 'Xevios',
		developer: 'bootleg',
		year: '1982',
		Notes: '',

		driver: Xevious,
		romsets: [
			{
				archive_name: 'xevious',
				mappings: [
				{
					name: 'PRG1',
					//roms: ['4.7h','5.6h','6.5h','7.4h'],
					roms: ['4.7h','5.6h','xvi_3.2m','7.4h'], //GOOD
				},
				{
					name: 'PRG2',
					//roms: ['8.2h','9.1h'],
					roms: ['xvi_5.3f','xvi_6.3j'], //GOOD
				},
				{
					name: 'PRG3',
					//roms: ['3.9h'],
					roms: ['xvi_7.2c'], //GOOD
				},
				{
					name: 'BG2',
					//roms: ['17.8f'],
					roms: ['xvi_12.3b'], //GOOD
				},
				{
					name: 'BG4',
					//roms: ['18.9f','19.11f'],
					roms: ['xvi_13.3c','xvi_14.3d'],
				},
				{
					name: 'OBJ',
					//roms: ['13.4d','15.7d','16.8d','14.6d'],
					roms: ['xvi_15.4m','xvi_17.4p','xvi_18.4r','xvi_16.4n'],
				},
				{
					name: 'MAPTBL',
					//roms: ['10.1d','11.2d'],
					roms: ['10.1d','xvi_10.2b'],
				},
				{
					name: 'MAPDATA',
					roms: ['12.3d'],
				},
				{
					name: 'RED',
					//roms: ['8.12h'],
					roms: ['xvi-8.6a'],
				},
				{
					name: 'GREEN',
					//roms: ['9.13h'],
					roms: ['xvi-9.6d'],
				},
				{
					name: 'BLUE',
					//roms: ['10.14h'],
					roms: ['xvi-10.6e'],
				},
				{
					name: 'BGCOLOR_L',
					//roms: ['7.14f'],
					roms: ['xvi-7.4h'],
				},
				{
					name: 'BGCOLOR_H',
					//roms: ['6.13f'],
					roms: ['xvi-6.4f'],
				},
				{
					name: 'OBJCOLOR_L',
					//roms: ['6.5c'],
					roms: ['xvi-4.3l'],
				},
				{
					name: 'OBJCOLOR_H',
					//roms: ['5.6c'],
					roms: ['xvi-5.3m'],
				},
				{
					name: 'SND',
					roms: ['xvi-2.7n'],
				},
				]
			},
			{
				archive_name: 'namco50',
				mappings: [
				{
					name: 'KEY',
					roms: ['50xx.bin'],
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
			{
				archive_name: 'namco54',
				mappings: [
				{
					name: 'PRG',
					roms: ['54xx.bin'],
				},
				]
			},
		]
	},
]

let ROM_INDEX = 0
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+(ROM_INDEX+1))

let PRG1, PRG2, PRG3, BG2, BG4, OBJ, MAPTBL, MAPDATA, RED, GREEN, BLUE, BGCOLOR_L, BGCOLOR_H, OBJCOLOR_L, OBJCOLOR_H, SND, KEY, IO, PRG;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG1       = ROM["PRG1"].addBase();
		PRG2       = ROM["PRG2"].addBase();
		PRG3       = ROM["PRG3"].addBase();
		BG2        = ROM["BG2"];
		BG4        = ROM["BG4"];
		OBJ        = ROM["OBJ"];
		MAPTBL     = ROM["MAPTBL"];
		MAPDATA    = ROM["MAPDATA"];
		RED        = ROM["RED"];
		GREEN      = ROM["GREEN"];
		BLUE       = ROM["BLUE"];
		BGCOLOR_L  = ROM["BGCOLOR_L"];
		BGCOLOR_H  = ROM["BGCOLOR_H"];
		OBJCOLOR_L = ROM["OBJCOLOR_L"];
		OBJCOLOR_H = ROM["OBJCOLOR_H"];
		SND        = ROM["SND"];
		
		KEY        = ROM["KEY"]; // NEEDS "50xx.bin"
		IO         = ROM["IO"];  // NEEDS "51xx.bin"
		PRG        = ROM["PRG"]; // NEEDS "54xx.bin"
		
		game    =   new ROM.settings.driver();
		sound = [
			new PacManSound({SND}),
			new Namco54XX({PRG, clock: Math.floor(18432000 / 12)}),
		];
		
		canvas.addEventListener('click', () => game.coin(true));
		init({game, sound});
		
	})
);



