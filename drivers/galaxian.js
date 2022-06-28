/*
 *
 *	Galaxian
 *
 */

import GalaxianSound from '../libs/EMU.js/devices/SOUND/galaxian_sound.js';
import SoundEffect from '../libs/EMU.js/devices/SOUND/sound_effect.js';
import {seq, rseq, convertGFX, Timer} from '../libs/EMU.js/utils.js';
import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import Z80 from '../libs/EMU.js/devices/CPU/z80.js';
let game;
let sound = [];

class Galaxian {
	cxScreen = 224;
	cyScreen = 256;
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
	nGalaxip = 3;
	nBonus = 'B';

	fInterruptEnable = false;
	mode = 0;
	ram = new Uint8Array(0x900).addBase();
	mmo = new Uint8Array(0x100);
	ioport = new Uint8Array(0x100);

	stars = [];
	fStarEnable = false;
	fStarMove = false;
	bg = new Uint8Array(0x4000).fill(3);
	obj = new Uint8Array(0x4000).fill(3);
	rgb = new Int32Array(0x80);
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;

	se;

	cpu = new Z80(Math.floor(18432000 / 6));
	timer = new Timer(60);


	constructor() {
		//SETUP CPU
		for (let i = 0; i < 0x28; i++)
			this.cpu.memorymap[i].base = PRG.base[i];
		for (let i = 0; i < 4; i++) {
			this.cpu.memorymap[0x40 + i].base = this.ram.base[i];
			this.cpu.memorymap[0x40 + i].write = null;
			this.cpu.memorymap[0x50 + i].base = this.ram.base[4 + i];
			this.cpu.memorymap[0x50 + i].write = null;
		}
		this.cpu.memorymap[0x58].base = this.ram.base[8];
		this.cpu.memorymap[0x58].write = null;
		this.cpu.memorymap[0x60].base = this.ioport;
		this.cpu.memorymap[0x60].write = (addr, data) => { this.mmo[addr & 7] = data & 1; };
		this.cpu.memorymap[0x68].base = this.ioport.subarray(0x10);
		this.cpu.memorymap[0x68].write = (addr, data) => {
			switch (addr & 7) {
			case 3: //BOMB
				data & 1 && (this.se[0].start = this.se[0].stop = true);
				break;
			case 5: //SHOT
				data & 1 && !this.mmo[0x15] && (this.se[1].start = this.se[1].stop = true);
				break;
			case 7: //SOUND VOICE/FREQUENCY
				sound[0].set_reg17(data);
				break;
			}
			this.mmo[addr & 7 | 0x10] = data & 1;
		};
		this.cpu.memorymap[0x70].base = this.ioport.subarray(0x20);
		this.cpu.memorymap[0x70].write = (addr, data) => {
			switch (addr & 7) {
			case 1:
				this.fInterruptEnable = (data & 1) !== 0;
				break;
			case 4:
				this.fStarEnable = (data & 1) !== 0, sound[0].control(data & 1);
				break;
			}
			this.mmo[addr & 7 | 0x20] = data & 1;
		};
		this.cpu.memorymap[0x78].write = (addr, data) => { sound[0].set_reg30(data), this.mmo[0x30] = data; }; //SOUND FREQUENCY

		this.cpu.breakpoint = (addr) => {
			switch (addr) {
			case 0x18c3:
				return void(!this.ram[0x07] && this.emulateWave(this.ram[0x021f]));
			case 0x1cc1:
				return this.emulateWave(0);
			}
		};
		this.cpu.set_breakpoint(0x18c3);
		this.cpu.set_breakpoint(0x1cc1);

		//SETUP VIDEO
		convertGFX(this.bg, BG, 256, rseq(8, 0, 8), seq(8), [0, BG.length * 4], 8);
		convertGFX(this.obj, BG, 64, rseq(8, 128, 8).concat(rseq(8, 0, 8)), seq(8).concat(seq(8, 64)), [0, BG.length * 4], 32);
		for (let i = 0; i < 0x20; i++)
			this.rgb[i] = 0xff000000 | (RGB[i] >> 6) * 255 / 3 << 16 | (RGB[i] >> 3 & 7) * 255 / 7 << 8 | (RGB[i] & 7) * 255 / 7;
		const starColors = [0xd0, 0x70, 0x40, 0x00];
		for (let i = 0; i < 0x40; i++)
			this.rgb[0x40 | i] = 0xff000000 | starColors[i >> 4 & 3] << 16 | starColors[i >> 2 & 3] << 8 | starColors[i & 3];
		for (let i = 0; i < 1024; i++)
			this.stars.push({x: 0, y: 0, color: 0});
		this.initializeStar();

		//Initialization of sound effects
		let s = sound[0].samples
		this.se = [s.BOMB, s.SHOT, s.WAVE0001, s.WAVE0010, s.WAVE0011, s.WAVE0100, s.WAVE0101, s.WAVE0110, s.WAVE0111, s.WAVE1000, s.WAVE1001, s.WAVE1010, s.WAVE1011, s.WAVE1100, s.WAVE1101, s.WAVE1110, s.WAVE1111].map(buf => ({freq: 11025, buf, loop: true, start: false, stop: false}));
		this.se[0].loop = this.se[1].loop = false;
	}

	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			this.cpu.execute(tick_rate);
			this.timer.execute(tick_rate, () => { this.moveStars(), update(), this.fInterruptEnable && this.cpu.non_maskable_interrupt(); });
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
			switch (this.nGalaxip) {
			case 3:
				this.ioport[0x20] &= 0xfb;
				break;
			case 5:
				this.ioport[0x20] |= 0x04;
				break;
			}
			switch (this.nBonus) {
			case 'NONE':
				this.ioport[0x20] &= 0xfc;
				break;
			case 'A':
				this.ioport[0x20] = this.ioport[0x20] & 0xfc | 0x01;
				break;
			case 'B':
				this.ioport[0x20] = this.ioport[0x20] & 0xfc | 0x02;
				break;
			case 'C':
				this.ioport[0x20] |= 0x03;
				break;
			}
			if (!this.fTest)
				this.fReset = true;
		}

		if (this.fTest)
			this.ioport[0] |= 0x40;
		else
			this.ioport[0] &= 0xbf;

		//RESET
		if (this.fReset) {
			this.fReset = false;
			this.se.forEach(se => se.stop = true);
			this.cpu.reset();
			this.fInterruptEnable = false;
		}
		return this;
	}

	emulateWave(_mode) {
		if (_mode === this.mode)
			return;
		if (this.mode)
			this.se[this.mode + 1].stop = true;
		if (_mode)
			this.se[_mode + 1].start = true;
		this.mode = _mode;
	}

	updateInput() {
		this.ioport[0] = this.ioport[0] & ~(1 << 0) | !!this.fCoin << 0;
		this.ioport[0x10] = this.ioport[0x10] & ~3 | !!this.fStart1P << 0 | !!this.fStart2P << 1;
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

	right(fDown) {
		this.ioport[0] = this.ioport[0] & ~(1 << 3 | fDown << 2) | fDown << 3;
	}

	left(fDown) {
		this.ioport[0] = this.ioport[0] & ~(1 << 2 | fDown << 3) | fDown << 2;
	}

	triggerA(fDown) {
		this.ioport[0] = this.ioport[0] & ~(1 << 4) | fDown << 4;
	}

	initializeStar() {
		let color;

		for (let sr = 0, i = 0, x = 255; x >= 0; --x) {
			for (let y = 0; y < 256; y++) {
				const cy = sr >> 4 ^ ~sr >> 16;
				sr = cy & 1 | sr << 1;
				if ((sr & 0x100ff) === 0xff && (color = sr >> 8 & 0x3f) && color !== 0x3f) {
					this.stars[i].x = x & 0xff;
					this.stars[i].y = y;
					this.stars[i].color = color;
					if (++i >= 1024)
						return;
				}
			}
		}
	}

	moveStars() {
		if (this.fStarEnable && (this.fStarMove = !this.fStarMove))
			for (let i = 0; i < 256 && this.stars[i].color; i++)
				if (++this.stars[i].y >= 0x100) {
					this.stars[i].y &= 0xff;
					this.stars[i].x = this.stars[i].x - 1 & 0xff;
				}
	}

	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;

		//bg drawing
		let p = 256 * 32;
		for (let k = 0x7e2, i = 2; i < 32; p += 256 * 8, k += 0x401, i++) {
			let dwScroll = this.ram[0x800 + i * 2];
			for (let j = 0; j < 32; k -= 0x20, j++) {
				this.xfer8x8(this.bitmap, p + dwScroll, k, i);
				dwScroll = dwScroll + 8 & 0xff;
			}
		}

		//obj drawing
		for (let k = 0x840, i = 8; i !== 0; k += 4, --i) {
			const x = this.ram[k], y = this.ram[k + 3] + 16;
			const src = this.ram[k + 1] & 0x3f | this.ram[k + 2] << 6;
			switch (this.ram[k + 1] & 0xc0) {
			case 0x00: //normal
				this.xfer16x16(this.bitmap, x | y << 8, src);
				break;
			case 0x40: //V invert
				this.xfer16x16V(this.bitmap, x | y << 8, src);
				break;
			case 0x80: //H invert
				this.xfer16x16H(this.bitmap, x | y << 8, src);
				break;
			case 0xc0: //HV invert
				this.xfer16x16HV(this.bitmap, x | y << 8, src);
				break;
			}
		}

		//bullets drawing
		for (let k = 0x860, i = 0; i < 8; k += 4, i++) {
			p = this.ram[k + 1] | 267 - this.ram[k + 3] << 8;
			this.bitmap[p + 0x300] = this.bitmap[p + 0x200] = this.bitmap[p + 0x100] = this.bitmap[p] = i > 6 ? 7 : 3;
		}

		//bg drawing
		p = 256 * 16;
		for (let k = 0x7e0, i = 0; i < 2; p += 256 * 8, k += 0x401, i++) {
			let dwScroll = this.ram[0x800 + i * 2];
			for (let j = 0; j < 32; k -= 0x20, j++) {
				this.xfer8x8(this.bitmap, p + dwScroll, k, i);
				dwScroll = dwScroll + 8 & 0xff;
			}
		}

		//star drawing
		if (this.fStarEnable) {
			p = 256 * 16;
			for (let i = 0; i < 256; i++) {
				const px = this.stars[i].color;
				if (!px)
					break;
				const x = this.stars[i].x, y = this.stars[i].y;
				if (x & 1 && ~y & 8 && !(this.bitmap[p + (x | y << 8)] & 3))
					this.bitmap[p + (x | y << 8)] = 0x40 | px;
				else if (~x & 1 && y & 8 && !(this.bitmap[p + (x | y << 8)] & 3))
					this.bitmap[p + (x | y << 8)] = 0x40 | px;
			}
		}

		//update palette
		p = 256 * 16 + 16;
		for (let i = 0; i < 256; p += 256 - 224, i++)
			for (let j = 0; j < 224; p++, j++)
				this.bitmap[p] = this.rgb[this.bitmap[p]];

		return this.bitmap;
	}

	xfer8x8(data, p, k, i) {
		const q = this.ram[k] << 6, idx = this.ram[0x801 + i * 2] << 2 & 0x1c;

		data[p + 0x000] = idx | this.bg[q | 0x00];
		data[p + 0x001] = idx | this.bg[q | 0x01];
		data[p + 0x002] = idx | this.bg[q | 0x02];
		data[p + 0x003] = idx | this.bg[q | 0x03];
		data[p + 0x004] = idx | this.bg[q | 0x04];
		data[p + 0x005] = idx | this.bg[q | 0x05];
		data[p + 0x006] = idx | this.bg[q | 0x06];
		data[p + 0x007] = idx | this.bg[q | 0x07];
		data[p + 0x100] = idx | this.bg[q | 0x08];
		data[p + 0x101] = idx | this.bg[q | 0x09];
		data[p + 0x102] = idx | this.bg[q | 0x0a];
		data[p + 0x103] = idx | this.bg[q | 0x0b];
		data[p + 0x104] = idx | this.bg[q | 0x0c];
		data[p + 0x105] = idx | this.bg[q | 0x0d];
		data[p + 0x106] = idx | this.bg[q | 0x0e];
		data[p + 0x107] = idx | this.bg[q | 0x0f];
		data[p + 0x200] = idx | this.bg[q | 0x10];
		data[p + 0x201] = idx | this.bg[q | 0x11];
		data[p + 0x202] = idx | this.bg[q | 0x12];
		data[p + 0x203] = idx | this.bg[q | 0x13];
		data[p + 0x204] = idx | this.bg[q | 0x14];
		data[p + 0x205] = idx | this.bg[q | 0x15];
		data[p + 0x206] = idx | this.bg[q | 0x16];
		data[p + 0x207] = idx | this.bg[q | 0x17];
		data[p + 0x300] = idx | this.bg[q | 0x18];
		data[p + 0x301] = idx | this.bg[q | 0x19];
		data[p + 0x302] = idx | this.bg[q | 0x1a];
		data[p + 0x303] = idx | this.bg[q | 0x1b];
		data[p + 0x304] = idx | this.bg[q | 0x1c];
		data[p + 0x305] = idx | this.bg[q | 0x1d];
		data[p + 0x306] = idx | this.bg[q | 0x1e];
		data[p + 0x307] = idx | this.bg[q | 0x1f];
		data[p + 0x400] = idx | this.bg[q | 0x20];
		data[p + 0x401] = idx | this.bg[q | 0x21];
		data[p + 0x402] = idx | this.bg[q | 0x22];
		data[p + 0x403] = idx | this.bg[q | 0x23];
		data[p + 0x404] = idx | this.bg[q | 0x24];
		data[p + 0x405] = idx | this.bg[q | 0x25];
		data[p + 0x406] = idx | this.bg[q | 0x26];
		data[p + 0x407] = idx | this.bg[q | 0x27];
		data[p + 0x500] = idx | this.bg[q | 0x28];
		data[p + 0x501] = idx | this.bg[q | 0x29];
		data[p + 0x502] = idx | this.bg[q | 0x2a];
		data[p + 0x503] = idx | this.bg[q | 0x2b];
		data[p + 0x504] = idx | this.bg[q | 0x2c];
		data[p + 0x505] = idx | this.bg[q | 0x2d];
		data[p + 0x506] = idx | this.bg[q | 0x2e];
		data[p + 0x507] = idx | this.bg[q | 0x2f];
		data[p + 0x600] = idx | this.bg[q | 0x30];
		data[p + 0x601] = idx | this.bg[q | 0x31];
		data[p + 0x602] = idx | this.bg[q | 0x32];
		data[p + 0x603] = idx | this.bg[q | 0x33];
		data[p + 0x604] = idx | this.bg[q | 0x34];
		data[p + 0x605] = idx | this.bg[q | 0x35];
		data[p + 0x606] = idx | this.bg[q | 0x36];
		data[p + 0x607] = idx | this.bg[q | 0x37];
		data[p + 0x700] = idx | this.bg[q | 0x38];
		data[p + 0x701] = idx | this.bg[q | 0x39];
		data[p + 0x702] = idx | this.bg[q | 0x3a];
		data[p + 0x703] = idx | this.bg[q | 0x3b];
		data[p + 0x704] = idx | this.bg[q | 0x3c];
		data[p + 0x705] = idx | this.bg[q | 0x3d];
		data[p + 0x706] = idx | this.bg[q | 0x3e];
		data[p + 0x707] = idx | this.bg[q | 0x3f];
	}

	xfer16x16(data, dst, src) {
		const idx = src >> 4 & 0x1c;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 272 * 0x100)
			return;
		src = src << 8 & 0x3f00;
		for (let i = 16; i !== 0; dst += 256 - 16, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.obj[src++]))
					data[dst] = idx | px;
	}

	xfer16x16V(data, dst, src) {
		const idx = src >> 4 & 0x1c;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 272 * 0x100)
			return;
		src = (src << 8 & 0x3f00) + 256 - 16;
		for (let i = 16; i !== 0; dst += 256 - 16, src -= 32, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.obj[src++]))
					data[dst] = idx | px;
	}

	xfer16x16H(data, dst, src) {
		const idx = src >> 4 & 0x1c;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 272 * 0x100)
			return;
		src = (src << 8 & 0x3f00) + 16;
		for (let i = 16; i !== 0; dst += 256 - 16, src += 32, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.obj[--src]))
					data[dst] = idx | px;
	}

	xfer16x16HV(data, dst, src) {
		const idx = src >> 4 & 0x1c;
		let px;

		if ((dst & 0xff) === 0 || (dst & 0xff) >= 240 || (dst & 0x1ff00) === 0 || dst >= 272 * 0x100)
			return;
		src = (src << 8 & 0x3f00) + 256;
		for (let i = 16; i !== 0; dst += 256 - 16, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.obj[--src]))
					data[dst] = idx | px;
	}
}

/*
 *
 *	Galaxian
 *
 */

const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		// Mame name  'galaxian'
		display_name: 'Galaxian (Namco set 1)',
		developer: 'Namco',
		year: '1979',
		Notes: '',

		driver: Galaxian,
		romsets: [{
			archive_name: 'galaxian',
			mappings: [
			{
				name: 'RGB',
				roms: ['6l.bpr'],
			},
			{
				name: 'PRG',
				roms: ['galmidw.u', 'galmidw.v', 'galmidw.w', 'galmidw.y', '7l'],
			},
			{
				name: 'BG',
				roms: ['1h.bin', '1k.bin'],
			},
			]
		}]
	},
	{
		// Mame name  'galaxiana'
		display_name: 'Galaxian (Namco set 2)',
		developer: 'Namco',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		driver: Galaxian,
		romsets: [{
			archive_name: 'galaxian',
			mappings: [
			{
				name: 'RGB',
				roms: ['6l.bpr'],
			},
			{
				name: 'PRG',
				roms: ['7f.bin', '7j.bin', '7l.bin'],
			},
			{
				name: 'BG',
				roms: ['1h.bin', '1k.bin'],
			},
		]}]
	},
	{
		// Mame name  'galaxianm'
		display_name: 'Galaxian (Midway set 1)',
		developer: 'Namco (Midway license)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galmidw.u', 'galmidw.v', 'galmidw.w', 'galmidw.y', 'galmidw.z'],
		},
		{
			name: 'BG',
			roms: ['galaxian.j1', 'galaxian.l1'],
		},
		]
	},
	{
		// Mame name  'galaxianmo'
		display_name: 'Galaxian (Midway set 2)',
		developer: 'Namco (Midway license)',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galaxian.u', 'galaxian.v', 'galaxian.w', 'galaxian.y', '7l.bin'],
		},
		{
			name: 'BG',
			roms: ['galaxian.j1', 'galaxian.l1'],
		},
		]
	},
	{
		// Mame name  'galaxiant'
		display_name: 'Galaxian (Taito)',
		developer: 'Namco (Taito license)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['gl-03.8g', 'gl-04.8f', 'gl-05.8e', 'gl-06.8d', 'gl-07.8c'],
		},
		{
			name: 'BG',
			roms: ['gl-02.1k', 'gl-01.1j'],
		},
		]
	},
	{
		// Mame name  'galaxiani'
		display_name: 'Galaxian (Irem)',
		developer: 'Namco (Irem license)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['cp-1.8g', 'cp-2.8f', 'cp-3.8e', 'cp-4.8d', 'cp-5.8c'],
		},
		{
			name: 'BG',
			roms: ['cp-7.1k', 'cp-6.1j'],
		},
		]
	},
	{
		// Mame name  'superg'
		display_name: "Super Galaxians ('Galaxian (Namco set 2)' hack)",
		developer: 'hack',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['7f.bin', 'superg.w', 'superg.y', 'superg.z'],
		},
		{
			name: 'BG',
			roms: ['galmidw.1j', 'galmidw.1k'],
		},
		]
	},
	{
		// Mame name  'supergs'
		display_name: 'Super Galaxians (Silver Systems)',
		developer: 'hack',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['7f.bin', 'superg.w', 'superg.y', 'supergs.z'],
		},
		{
			name: 'BG',
			roms: ['galmidw.1j', 'galmidw.1k'],
		},
		]
	},
	{
		// Mame name  'galturbo'
		display_name: "Galaxian Turbo ('Super Galaxians' hack)",
		developer: 'hack',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galturbo.u', 'galx.v', 'superg.w', 'galturbo.y', 'galturbo.z'],
		},
		{
			name: 'BG',
			roms: ['galturbo.1h', 'galturbo.1k'],
		},
		]
	},
	{
		// Mame name  'galap1'
		display_name: 'Space Invaders Galactica ("Galaxian (Namco set 2)" hack)',
		developer: 'hack',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['7f.bin', 'galaxian.w', 'galx_1_4.rom', 'galx_1_5.rom'],
		},
		{
			name: 'BG',
			roms: ['galmidw.1j', 'galmidw.1k'],
		},
		]
	},
	{
		// Mame name  'galap4'
		display_name: 'Galaxian Part 4 (hack)',
		developer: 'hack (G.G.I)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galnamco.u', 'galnamco.v', 'galnamco.w', 'galnamco.y', 'galnamco.z'],
		},
		{
			name: 'BG',
			roms: ['galx_4c1.rom', 'galx_4c2.rom'],
		},
		]
	},
	{
		// Mame name  'zerotime'
		display_name: 'Zero Time (Petaco S.A.)',
		developer: 'bootleg? (Petaco S.A.)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['zt-p01c.016', 'zt-2.016', 'zt-3.016', 'zt-4.016', 'zt-5.016'],
		},
		{
			name: 'BG',
			roms: ['ztc-2.016', 'ztc-1.016'],
		},
		]
	},


	{
		// Mame name  'galaktron'
		display_name: 'Galaktron (Petaco S.A.)',
		developer: 'bootleg (Petaco S.A.)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['galaktron_pr.bin'],
		},
		{
			name: 'PRG',
			roms: ['galaktron_g1.bin', 'galaktron_g2.bin', 'galaktron_g3.bin', 'galaktron_g4.bin', 'galaktron_g5.bin'],
		},
		{
			name: 'BG',
			roms: ['galaktron_c2.bin', 'galaktron_c1.bin'],
		},
		]
	},
	{
		// Mame name  'galkamika'
		display_name: 'Kamikaze (Electrogame',
		developer: 'bootleg (Electrogame)',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['m866l_im5610.6l'],
		},
		{
			name: 'PRG',
			roms: ['3.bin', '2.bin', '1.bin', '4.bin', '5.bin'],
		},
		{
			name: 'BG',
			roms: ['hj.bin', 'kl.bin'],
		},
		]
	},
	{
		// Mame name  'zerotimed'
		display_name: 'Zero Time (Datamat)',
		developer: 'bootleg (Datamat)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['zerotime_datamat.bin'],
		},
		{
			name: 'BG',
			roms: ['ztc-2.016', 'ztc-1.016'],
		},
		]
	},
	{
		// Mame name  'zerotimemc'
		display_name: 'Zero Time (Marti Colls)',
		developer: 'bootleg (Marti Colls)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['4_7k.bin', '5_7j.bin', '6_7h.bin', '7_7f.bin', '3_7l.bin'],
		},
		{
			name: 'BG',
			roms: ['2_1hj.bin', '1_1kl.bin'],
		},
		]
	},
	{
		// Mame name  'zerotimeu'
		display_name: 'Zero Time (Spanish bootleg)',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['82s123.bin'],
		},
		{
			name: 'PRG',
			roms: ['1.bin', '2.bin', '3.bin', '4.bin', '5.bin'],
		},
		{
			name: 'BG',
			roms: ['hj.bin', 'kl.bin'],
		},
		]
	},
	{
		// Mame name  'galaxcirsa'
		display_name: 'Galaxian (Cirsa Spanish bootleg)',
		developer: 'bootleg (Cirsa)',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6113_1.bin'],
		},
		{
			name: 'PRG',
			roms: ['cirsagal.1', 'cirsagal.2', 'cirsagal.3', 'cirsagal.4', 'cirsagal.5'],
		},
		{
			name: 'BG',
			roms: ['cirsagal.h', 'cirsagal.i'],
		},
		]
	},
	{
		// Mame name  'starfght'
		display_name: 'Star Fighter',
		developer: 'bootleg (Jeutel)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.7f'],
		},
		{
			name: 'PRG',
			roms: ['ja.1', 'jb.2', 'jc.3', 'jd.4', 'je.5', 'jf.6', 'jg.7', 'jh.8', 'ji.9', 'jj.10'],
		},
		{
			name: 'BG',
			roms: ['k1.7a', 'k2.9a'],
		},
		]
	},
	{
		// Mame name  'galaxbsf'
		display_name: 'Galaxian (bootleg',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['1.bn', '2.bn', '3.bn', '4.bn', '5.bn', '6.bn', '7.bn', '8.bn', '9.bn', '10.bn'],
		},
		{
			name: 'BG',
			roms: ['11.bn', '12.bn'],
		},
		]
	},
	{
		// Mame name  'galaxianbl'
		display_name: 'Galaxian (bootleg',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['gal00eg.ic4', 'gal01eg.ic5', 'gal02.ic6', 'gal03.ic7', 'gal04.ic8', 'gal05.ic9', 'gal06.ic10', 'gal07eg.ic11', 'gal08.ic12', 'gal09.ic13'],
		},
		{
			name: 'BG',
			roms: ['galaxian.1h', 'galaxian.1k'],
		},
		]
	},
	{
		// Mame name  'galaxbsf2'
		display_name: 'Galaxian (bootleg',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'unknown',
			roms: ['gal00eg.ic4'],
		},
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['gal00eg.ic41', 'gal01eg.ic5', 'gal02.ic6', 'gal03.ic7', 'gal04.ic8', 'gal05.ic9', 'gal06.ic10', 'gal07eg.ic11', 'gal08.ic12', 'gal09.ic13'],
		},
		{
			name: 'BG',
			roms: ['galaxian.1h', 'galaxian.1k'],
		},
		]
	},
	{
		// Mame name  'galaxianbl2'
		display_name: 'Galaxian (bootleg',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6331-1j.6l'],
		},
		{
			name: 'PRG',
			roms: ['h7.7h', 'j7.7j', 'k7.7k', 'l7.7l', 'm7.7m'],
		},
		{
			name: 'BG',
			roms: ['kl1.1kl', 'hj1.1hj'],
		},
		]
	},
	{
		// Mame name  'galaxianbl3'
		display_name: 'Galaxian (Spanish bootleg)',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['im8610.6l'],
		},
		{
			name: 'PRG',
			roms: ['1r.bin', '2r.bin', '3r.bin', '4r.bin', '5r.bin'],
		},
		{
			name: 'BG',
			roms: ['1kl.bin', '2hj.bin'],
		},
		]
	},
	{
		// Mame name  'galaxianem'
		display_name: 'Galaxian (Electromar Spanish bootleg)',
		developer: 'bootleg (Electromar)',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['im5610.bin'],
		},
		{
			name: 'PRG',
			roms: ['fg1.bin', 'fg2.bin', 'fg3.bin', 'fg4.bin', 'fg5.bin'],
		},
		{
			name: 'BG',
			roms: ['hj.bin', 'kl.bin'],
		},
		]
	},
	{
		// Mame name  'galaxrf'
		display_name: 'Galaxian (Recreativos Franco S.A. Spanish bootleg)',
		developer: 'bootleg (Recreativos Franco S.A.)',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['princip1.u', 'princip2.v', 'princip3.w', 'princip4.y', 'princip5.z'],
		},
		{
			name: 'BG',
			roms: ['graphhj.j1', 'graphkl.l1'],
		},
		]
	},
	{
		// Mame name  'galaxrfgg'
		display_name: 'Galaxian Growing Galaxip / Galaxian Nave Creciente (Recreativos Franco S.A. Spanish bootleg)',
		developer: 'bootleg (Recreativos Franco S.A.)',
		year: '1980',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['gxrf.6l'],
		},
		{
			name: 'PRG',
			roms: ['gxrf.7f', 'gxrf.7j', 'gxrf.7l'],
		},
		{
			name: 'BG',
			roms: ['gxrf.1jh', 'gxrf.1lk'],
		},
		]
	},
	{
		// Mame name  'galaxrcgg'
		display_name: 'Galaxian Growing Galaxip / Galaxian Nave Creciente (Recreativos Covadonga Spanish bootleg)',
		developer: 'bootleg (Recreativos Covadonga)',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['gxrf.6l'],
		},
		{
			name: 'PRG',
			roms: ['7f.bin', '7j.bin', '7l.bin'],
		},
		{
			name: 'BG',
			roms: ['1hj.bin', '1kl.bin'],
		},
		]
	},
	{
		// Mame name  'galaxianrp'
		display_name: 'Galaxian (Rene Pierre bootleg)',
		developer: 'bootleg (Valadon Automation / Rene Pierre)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['4.7k', '5.7j', '6.7h', '7.7f', '3.7l'],
		},
		{
			name: 'BG',
			roms: ['2.1j', '1.1l'],
		},
		]
	},
	{
		// Mame name  'galaxyx'
		display_name: 'Galaxy X (bootleg of Galaxian)',
		developer: 'bootleg',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['sgprom.6l'],
		},
		{
			name: 'PRG',
			roms: ['sg1', 'sg2', 'sg3', 'sg4', 'sg5.7l'],
		},
		{
			name: 'BG',
			roms: ['sg6.1h', 'sg7.1k'],
		},
		]
	},
	{
		// Mame name  'galartic'
		display_name: 'Galaxian (Artic System bootleg)',
		developer: 'bootleg (Artic System)',
		year: '1979',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['piii.1', 'piii.2', 'piii.3', 'piii.4', 'piii.5'],
		},
		{
			name: 'BG',
			roms: ['piii.6', 'piii.7'],
		},
		]
	},
	{
		// Mame name  'moonaln'
		display_name: 'Moon Alien',
		developer: 'Namco / Nichibutsu (Karateco license?)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galx.u', 'prg2.bin', 'prg3.bin', 'superg.y', 'prg5.bin'],
		},
		{
			name: 'BG',
			roms: ['ca1.bin', 'ca2.bin'],
		},
		]
	},
	{
		// Mame name  'galapx'
		display_name: 'Galaxian Part X ("Moon Alien" hack)',
		developer: 'hack',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['galx.u', 'galx.v', 'galx.w', 'galx.y', 'galx.z'],
		},
		{
			name: 'BG',
			roms: ['galx.1h', 'galx.1k'],
		},
		]
	},
	{
		// Mame name  'kamikazp'
		display_name: 'Kamikaze (Potomac Games',
		developer: 'bootleg (Potomac Games)',
		year: '1979',
		Notes: 'TODO: BROKE + NO INPUTS',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom.6l'],
		},
		{
			name: 'PRG',
			roms: ['kk1pmc.bin', 'kk2pmc.bin', 'kk3pmc.bin', 'kk4pmc.bin', 'kk5pmc.bin', 'kk6pmc.bin'],
		},
		{
			name: 'BG',
			roms: ['kk8pmc.bin', 'kk7pmc.bin'],
		},
		]
	},
	{
		// Mame name  'supergx'
		display_name: 'Super GX',
		developer: 'Namco / Nichibutsu',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['supergx.prm'],
		},
		{
			name: 'PRG',
			roms: ['sg1', 'sg2', 'sg3', 'sg4', 'sg5', 'sg6'],
		},
		{
			name: 'BG',
			roms: ['sgg1', 'sgg2'],
		},
		]
	},
	{
		// Mame name  'swarm'
		display_name: 'Swarm (bootleg?)',
		developer: 'bootleg? (Subelectro)',
		year: '1979',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['swarm1.bin', 'swarm2.bin', 'swarm3.bin', 'swarm4.bin', 'swarm5.bin'],
		},
		{
			name: 'BG',
			roms: ['swarma.bin', 'swarmb.bin'],
		},
		]
	},
	{
		// Mame name  'astrians'
		display_name: 'Astrians (clone of Swarm)',
		developer: 'bootleg (BGV Ltd.)',
		year: '1980',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom.6l'],
		},
		{
			name: 'PRG',
			roms: ['astrians.7h', 'astrians.7j', 'astrians.7k', 'astrians.7l', 'astrians.7m'],
		},
		{
			name: 'BG',
			roms: ['astrians.1h', 'astrians.1k'],
		},
		]
	},
	{
		// Mame name  'tst_galx'
		display_name: 'Galaxian Test ROM',
		developer: '<unknown>',
		year: '19??',
		Notes: '',

		archive_name: 'galaxian',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['test.u', 'galmidw.v', 'galmidw.w', 'galmidw.y', '7l'],
		},
		{
			name: 'BG',
			roms: ['1h.bin', '1k.bin'],
		},
		]
	},
	{
		// Mame name  'blkhole'
		display_name: 'Black Hole',
		developer: 'TDS & MINTS',
		year: '1981',
		Notes: 'TODO: BROKEN',

		archive_name: 'blkhole',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l.bpr'],
		},
		{
			name: 'PRG',
			roms: ['bh1', 'bh2', 'bh3', 'bh4', 'bh5', 'bh6'],
		},
		{
			name: 'BG',
			roms: ['bh7', 'bh8'],
		},
		]
	},
	{
		// Mame name  'orbitron'
		display_name: 'Orbitron',
		developer: 'Comsoft (Signatron USA license)',
		year: '1982',
		Notes: 'TODO: BROKEN STUCK AT BOOT :(',

		archive_name: 'orbitron',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['l06_prom.bin'],
		},
		{
			name: 'PRG',
			roms: ['orbitron.3', 'orbitron.4', 'orbitron.1', 'orbitron.2', 'orbitron.5'],
		},
		{
			name: 'BG',
			roms: ['orbitron.6', 'orbitron.7'],
		},
		]
	},
	{
		// Mame name  'luctoday'
		display_name: 'Lucky Today',
		developer: 'Sigma',
		year: '1980',
		Notes: 'TODO: NO INPUTS',

		archive_name: 'luctoday',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['74s288.ch'],
		},
		{
			name: 'PRG',
			roms: ['ltprog1.bin', 'ltprog2.bin'],
		},
		{
			name: 'BG',
			roms: ['ltchar2.bin', 'ltchar1.bin'],
		},
		]
	},
	{
		// Mame name  'chewing'
		display_name: 'Chewing Gum',
		developer: '<unknown>',
		year: '19??',
		Notes: 'TODO: NO INPUTS',

		archive_name: 'luctoday',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['74s288.ch'],
		},
		{
			name: 'PRG',
			roms: ['1.bin', '7l.bin'],
		},
		{
			name: 'BG',
			roms: ['2.bin', '3.bin'],
		},
		]
	},
	{
		// Mame name  'catacomb'
		display_name: 'Catacomb',
		developer: 'MTM Games',
		year: '1982',
		Notes: 'TODO: CRASHES Z80 CODE AFTER A SECOND OF GAMEPLAY.',

		archive_name: 'catacomb',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['catacomb.u', 'catacomb.v', 'catacomb.w', 'catacomb.y'],
		},
		{
			name: 'BG',
			roms: ['cat-gfx1', 'cat-gfx2'],
		},
		]
	},
	{
		// Mame name  'omegab'
		display_name: 'Omega (bootleg?)',
		developer: 'bootleg?',
		year: '19??',
		Notes: 'TODO: NO INPUTS',

		archive_name: 'theend',
		driver: Galaxian,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331-1j.86'],
		},
		{
			name: 'PRG',
			roms: ['omega1.bin', 'omega2.bin', 'omega3.bin', 'omega4.bin', 'omega5.bin', 'omega6.bin'],
		},
		{
			name: 'BG',
			roms: ['omega1h.bin', 'omega1k.bin'],
		},
		]
	},

];
let ROM_INDEX = 0
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+ROM_INDEX)

let BG, RGB, PRG;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG   = ROM["PRG"].addBase();
		BG    = ROM["BG" ];
		RGB   = ROM["RGB"];
		
		sound.push( new GalaxianSound() )
		game    =   new ROM.settings.driver();
		sound.push( new SoundEffect({se: game.se, gain: 0.5}) )
		
		canvas.addEventListener('click', () => game.coin(true));
		init({game, sound});
		
	})
);
