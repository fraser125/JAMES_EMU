/*
 *
 *	Moon Cresta
 *
 */

// Based on Galaxian, but with altered address map for more ROM

import GalaxianSound from '../libs/EMU.js/devices/SOUND/galaxian_sound.js';
import SoundEffect from '../libs/EMU.js/devices/SOUND/sound_effect.js';
import {seq, rseq, convertGFX, Timer} from '../libs/EMU.js/utils.js';
import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import Z80 from '../libs/EMU.js/devices/CPU/z80.js';
let game;
let sound = [];

class MoonCresta {
	static decoded = false;

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
	nBonus = 30000;

	fInterruptEnable = false;

	ram = new Uint8Array(0x900).addBase();
	mmo = new Uint8Array(0x100);
	in = new Uint8Array(3);

	stars = [];
	fStarEnable = false;
	fStarMove = false;
	bank = 0;
	bg = new Uint8Array(0x8000).fill(3);
	obj = new Uint8Array(0x8000).fill(3);
	rgb = new Int32Array(0x80);
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;
	
	se = [sound[0].samples.BOMB, sound[0].samples.SHOT].map(buf => ({freq: 11025, buf, loop: false, start: false, stop: false}));

	cpu = new Z80(Math.floor(18432000 / 6));
	timer = new Timer(60);

	constructor() {
		//SETUP CPU
		const range = (page, start, end, mirror = 0) => (page & ~mirror) >= start && (page & ~mirror) <= end;

		for (let page = 0; page < 0x100; page++)
			if (range(page, 0, 0x3f))
				this.cpu.memorymap[page].base = PRG.base[page & 0x3f];
			else if (range(page, 0x80, 0x83, 0x04)) {
				this.cpu.memorymap[page].base = this.ram.base[page & 3];
				this.cpu.memorymap[page].write = null;
			} else if (range(page, 0x90, 0x93, 0x04)) {
				this.cpu.memorymap[page].base = this.ram.base[4 | page & 3];
				this.cpu.memorymap[page].write = null;
			} else if (range(page, 0x98, 0x98, 0x07)) {
				this.cpu.memorymap[page].base = this.ram.base[8];
				this.cpu.memorymap[page].write = null;
			} else if (range(page, 0xa0, 0xa0, 0x07)) {
				this.cpu.memorymap[page].read = () => { return this.in[0]; };
				this.cpu.memorymap[page].write = (addr, data) => { this.mmo[addr & 7] = data & 1, this.bank = this.mmo[0] | this.mmo[1] << 1; };
			} else if (range(page, 0xa8, 0xa8, 0x07)) {
				this.cpu.memorymap[page].read = () => { return this.in[1]; };
				this.cpu.memorymap[page].write = (addr, data) => {
					switch (addr & 7) {
					case 3: //BOMB
						data & 1 ? (this.se[0].start = true) : (this.se[0].stop = true);
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
			} else if (range(page, 0xb0, 0xb0, 0x07)) {
				this.cpu.memorymap[page].read = () => { return this.in[2]; };
				this.cpu.memorymap[page].write = (addr, data) => {
					switch (addr & 7) {
					case 0:
						this.fInterruptEnable = (data & 1) !== 0;
						break;
					case 4:
						this.fStarEnable = (data & 1) !== 0, sound[0].control(data & 1);
						break;
					}
					this.mmo[addr & 7 | 0x20] = data & 1;
				};
			} else if (range(page, 0xb8, 0xb8, 0x07))
				this.cpu.memorymap[page].write = (addr, data) => { sound[0].set_reg30(data), this.mmo[0x30] = data; };

		this.decodeROM();

		//SETUP VIDEO
		convertGFX(this.bg, BG, 512, rseq(8, 0, 8), seq(8), [0, BG.length * 4], 8);
		convertGFX(this.obj, BG, 128, rseq(8, 128, 8).concat(rseq(8, 0, 8)), seq(8).concat(seq(8, 64)), [0, BG.length * 4], 32);
		for (let i = 0; i < 0x20; i++)
			this.rgb[i] = 0xff000000 | (RGB[i] >> 6) * 255 / 3 << 16 | (RGB[i] >> 3 & 7) * 255 / 7 << 8 | (RGB[i] & 7) * 255 / 7;
		const starColors = [0xd0, 0x70, 0x40, 0x00];
		for (let i = 0; i < 0x40; i++)
			this.rgb[0x40 | i] = 0xff000000 | starColors[i >> 4 & 3] << 16 | starColors[i >> 2 & 3] << 8 | starColors[i & 3];
		for (let i = 0; i < 1024; i++)
			this.stars.push({x: 0, y: 0, color: 0});
		this.initializeStar();
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
			switch (this.nBonus) {
			case 30000:
				this.in[1] &= ~0x40;
				break;
			case 50000:
				this.in[1] |= 0x40;
				break;
			}
			if (!this.fTest)
				this.fReset = true;
		}

		//RESET
		if (this.fReset) {
			this.fReset = false;
			this.se.forEach(se => se.stop = true);
			this.cpu.reset();
			this.fInterruptEnable = false;
		}
		return this;
	}

	updateInput() {
		this.in[0] = this.in[0] & ~(1 << 0) | !!this.fCoin << 0;
		this.in[1] = this.in[1] & ~3 | !!this.fStart1P << 0 | !!this.fStart2P << 1;
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
		this.in[0] = this.in[0] & ~(1 << 3 | fDown << 2) | fDown << 3;
	}

	left(fDown) {
		this.in[0] = this.in[0] & ~(1 << 2 | fDown << 3) | fDown << 2;
	}

	triggerA(fDown) {
		this.in[0] = this.in[0] & ~(1 << 4) | fDown << 4;
	}

	decodeROM() { // Go to the "MoonCrestaEncrypted" for encryption code
		MoonCresta.decoded = true;
		return
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
		let q = this.ram[k] << 6, idx = this.ram[0x801 + i * 2] << 2 & 0x1c;

		if (this.mmo[2] && (this.ram[k] & 0xc0) === 0x80)
			q = (this.ram[k] & 0x3f | this.bank << 6 | 0x100) << 6 & 0x7ffc0;
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
		if (this.mmo[2] && (src & 0x30) === 0x20)
			src = src << 8 & 0x0f00 | this.bank << 12 | 0x4000;
		else
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
		if (this.mmo[2] && (src & 0x30) === 0x20)
			src = (src << 8 & 0x0f00 | this.bank << 12 | 0x4000) + 256 - 16;
		else
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
		if (this.mmo[2] && (src & 0x30) === 0x20)
			src = (src << 8 & 0x0f00 | this.bank << 12 | 0x4000) + 16;
		else
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
		if (this.mmo[2] && (src & 0x30) === 0x20)
			src = (src << 8 & 0x0f00 | this.bank << 12 | 0x4000) + 256;
		else
			src = (src << 8 & 0x3f00) + 256;
		for (let i = 16; i !== 0; dst += 256 - 16, --i)
			for (let j = 16; j !== 0; dst++, --j)
				if ((px = this.obj[--src]))
					data[dst] = idx | px;
	}
}


/*
 *
 *	Moon Cresta - alts
 *
 */

class MoonCrestaEncrypted extends MoonCresta {
	decodeROM() {
		if (MoonCresta.decoded)
			return;
		for (let i = 0; i < PRG.length; i++) {
			PRG[i] ^= PRG[i] << 5 & 0x40;
			PRG[i] ^= PRG[i] >> 3 & 4;
			if (~i & 1)
				PRG[i] = PRG[i] & 0xbb | PRG[i] << 4 & 0x40 | PRG[i] >> 4 & 4;
		}
		MoonCresta.decoded = true;
	}
}


/*
 *
 *	Moon Cresta
 *
 */
 

const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		display_name: 'Moon Cresta (Nichibutsu)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCrestaEncrypted,
		mappings: [
			{
				name: 'PRG',
				roms: ["mc1", "mc2", "mc3", "mc4", "mc5.7r", "mc6.8d", "mc7.8e", "mc8"],
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Nichibutsu UK)', // is this even the UK version? like there is still japanese in it
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCrestaEncrypted,
		mappings: [
			{
				name: 'PRG',
				roms: ["mc1", "mc2", "mc3", "mc4", "mc5.7r", "mc6.8d", "mc7.8e", "8_uk.bin"], // only last rom changed
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Nichibutsu UK, unencrypted)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["smc1f", "smc2f", "smc3f", "smc4f", "smc5f", "smc6f", "smc7f", "smc8f_uk"], // only last rom changed
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Nichibutsu USA)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCrestaEncrypted,
		mappings: [
			{
				name: 'PRG',
				roms: ["mc1", "mc2", "mc3", "mc4", "mc5.7r", "mc6.8d", "mc7.8e", "smc8f_uk"],
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Nichibutsu USA unencrypted)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["smc1f", "smc2f", "smc3f", "smc4f", "smc5f", "smc6f", "smc7f", "smc8f_uk"],
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Nichibutsu, old rev)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCrestaEncrypted,
		mappings: [
			{
				name: 'PRG',
				roms: ["mc1.7d", "mc2.7e", "mc3.7j", "mc4.7p", "mc5.7r", "mc6.8d", "mc7.8e", "mc8.8h"],
			},
			{
				name: 'BG',
				roms: ["mcs_b", "mcs_d", "mcs_a", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	{
		display_name: 'Moon Cresta (Gremlin)',
		developer: 'Nichibutsu',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["epr194", "epr195", "epr196", "epr197", "epr198", "epr199", "epr200", "epr201"],
			},
			{
				name: 'BG',
				roms: ["epr203", "mcs_d", "epr202", "mcs_c"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'],
			},
		],
	},
	
	
	
	/*
	 *
	 *	Eagle
	 *
	 */
	
	{
		display_name: 'Eagle (set 1)',
		developer: 'Nichibutsu (Centuri license)',
		year: '1980',
		Notes: 'Missing "l06_prom.bin"',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["e1", "e2", "f03.bin", "f04.bin", "e5", "e6", "e7", "e8"],
			},
			{
				name: 'BG',
				roms: ["e10", "e12", "e9", "e11"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'], // Mame uses "l06_prom.bin" but it apears missing
			},
		],
	},
	{
		display_name: 'Eagle (set 2)',
		developer: 'Nichibutsu (Centuri license)',
		year: '1980',
		Notes: 'Missing "l06_prom.bin"',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["e1.7f", "e2", "f03.bin", "f04.bin", "e5", "e6.6", "e7", "e8"],
			},
			{
				name: 'BG',
				roms: ["e10.2", "e12", "e9", "e11"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'], // Mame uses "l06_prom.bin" but it apears missing
			},
		],
	},
	{
		display_name: 'Eagle (set 3)',
		developer: 'Nichibutsu (Centuri license)',
		year: '1980',
		Notes: 'Missing "l06_prom.bin"',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
			{
				name: 'PRG',
				roms: ["e1", "e2", "f03.bin", "f04.bin", "e5", "e6.6", "e7", "e8"],
			},
			{
				name: 'BG',
				roms: ["e10a", "e12", "e9a", "e11"],
			},
			{
				name: 'RGB',
				roms: ['mmi6331.6l'], // Mame uses "l06_prom.bin" but it apears missing
			},
		],
	},
	
	
	
	/*
	 *
	 *	Bootlegs
	 *
	 */
	 
	{
		// Mame name  'mooncrsb'
		display_name: 'Moon Cresta (bootleg set 1)',
		developer: 'bootleg',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['bepr194', 'bepr195', 'f03.bin', 'f04.bin', 'e5', 'bepr199', 'e7', 'bepr201'],
		},
		{
			name: 'BG',
			roms: ['epr203', 'mcs_d', 'epr202', 'mcs_c'],
		},
		]
	},
	{
		// Mame name  'mooncrs2'
		display_name: 'Moon Cresta (bootleg set 2)',
		developer: 'bootleg',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['f8.bin', 'bepr195', 'f03.bin', 'f04.bin', 'e5', 'bepr199', 'e7', 'm7.bin'],
		},
		{
			name: 'BG',
			roms: ['1h_1_10.bin', '12.chr', '1k_1_11.bin', '11.chr'],
		},
		]
	},
	{
		// Mame name  'mooncrs3'
		display_name: 'Moon Cresta (bootleg set 3)',
		developer: 'bootleg (Jeutel)',
		year: '1980',
		Notes: 'TODO: BROKEN [crashes and pews can be heard]',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['b1.7f', 'b2.7h', 'b3.7j', 'b4.7k'],
		},
		{
			name: 'BG',
			roms: ['o.1h', 'q.1h', 'p.1k', 'r.1k'],
		},
		]
	},
	{
		// Mame name  'mooncrs4'
		display_name: 'Moon Crest (Moon Cresta bootleg)',
		developer: 'bootleg (SG-Florence)',
		year: '1980',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom.6l'],
		},
		{
			name: 'PRG',
			roms: ['mooncrs4.7k', 'mooncrs4.7j', 'mooncrs4.7h', 'mooncrs4.7f'],
		},
		{
			name: 'BG',
			roms: ['mooncrs4.1h', 'mooncrs4.1k'],
		},
		]
	},
	{
		// Mame name  'mooncrs5'
		display_name: 'Moon Cresta (bootleg set 4)',
		developer: 'bootleg',
		year: '1980',
		Notes: 'TODO: BROKEN [crashes and pews can be heard]',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['f_r_a.bin', 'f_f_a.bin', 'f_f_b.bin', 'f_r_c.bin', 'f_r_d.bin', 'f_f_e.bin', 'f_f_f.bin', 'f_r_f.bin', 'm7.bin'],
		},
		{
			name: 'BG',
			roms: ['r_r_a.bin', 'r_f_a.bin', 'r_r_b.bin', 'r_f_b.bin'],
		},
		]
	},
	{
		// Mame name  'fantazia'
		display_name: 'Fantazia (bootleg?)',
		developer: 'bootleg (Subelectro)',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['fantazia.clr'],
		},
		{
			name: 'PRG',
			roms: ['f01.bin', 'f02.bin', 'f03.bin', 'f04.bin', 'f09.bin', 'f10.bin', 'f11.bin', 'f12.bin'],
		},
		{
			name: 'BG',
			roms: ['1h_1_10.bin', 'mcs_d', '1k_1_11.bin', 'mcs_c'],
		},
		]
	},
	{
		// Mame name  'spctbird'
		display_name: 'Space Thunderbird',
		developer: 'bootleg (Fortrek)',
		year: '1981?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['l06_prom.bin'],
		},
		{
			name: 'PRG',
			roms: ['tssa-7f', 'tssa-7h', 'tssa-7k', 'tssa-7m', 'tssa-5', 'tssa-6', 'tssa-7', 'tssa-8'],
		},
		{
			name: 'BG',
			roms: ['tssb-2', 'tssb-4', 'tssb-1', 'tssb-3'],
		},
		]
	},
	{
		// Mame name  'smooncrs'
		display_name: 'Super Moon Cresta (Gremlin',
		developer: 'bootleg (Gremlin)',
		year: '1980?',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['927', '928a', '929', '930', '931', '932a', '933', '934'],
		},
		{
			name: 'BG',
			roms: ['epr203', 'mcs_d', 'epr202', 'mcs_c'],
		},
		]
	},
	{
		// Mame name  'meteora'
		display_name: 'Meteor (Alca bootleg of Moon Cresta)',
		developer: 'bootleg (Alca)',
		year: '1980?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mr13.31'],
		},
		{
			name: 'PRG',
			roms: ['mr02.6', 'mr01.5', 'mr03.13', 'mr04.14', 'mr05.18', 'mr06.19', 'mr07.26', 'mr08.27'],
		},
		{
			name: 'BG',
			roms: ['mr10.38', 'mr12.21', 'mr09.37', 'mr11.20'],
		},
		]
	},
	{
		// Mame name  'mooncrstso'
		display_name: 'Moon Cresta (SegaSA / Sonic)',
		developer: 'bootleg (Sonic)',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['1.bin', '2.bin', '3.bin', '4.bin', '5.bin', '6.bin', '7.bin', '8.bin'],
		},
		{
			name: 'BG',
			roms: ['epr203', 'mcs_d', 'epr202', 'mcs_c'],
		},
		]
	},
	{
		// Mame name  'mooncptc'
		display_name: 'Moon Cresta (Petaco S.A. Spanish bootleg)',
		developer: 'bootleg (Petaco S.A.)',
		year: '1980?',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['mc1.bin', 'mc2.bin', 'mc3.bin', 'mc4.bin', 'mc5.bin', 'mc6.bin', 'mc7.bin', 'mc8.bin'],
		},
		{
			name: 'BG',
			roms: ['mc12.bin', 'mc14.bin', 'mc11.bin', 'mc13.bin'],
		},
		]
	},
	{
		// Mame name  'mouncrst'
		display_name: 'Moune Creste (Jeutel French Moon Cresta bootleg)',
		developer: 'bootleg (Jeutel)',
		year: '1980?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom.6l'],
		},
		{
			name: 'PRG',
			roms: ['w.7f', 'x.7h', 'y.7j', 'z.7k'],
		},
		{
			name: 'BG',
			roms: ['k.1h', 'm.1h', 'l.1k', 'n.1k'],
		},
		]
	},
	{
		// Mame name  'sirio2'
		display_name: 'Sirio II (Calfesa S.L. Spanish Moon Cresta bootleg)',
		developer: 'bootleg (Calfesa S.L.)',
		year: '1980?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['sirio2_im5610.bin'],
		},
		{
			name: 'PRG',
			roms: ['sirio2_1.bin', 'sirio2_2.bin', 'sirio2_3.bin', 'sirio2_4.bin', 'sirio2_5.bin', 'sirio2_6.bin', 'sirio2_7.bin', 'sirio2_8.bin'],
		},
		{
			name: 'BG',
			roms: ['sirio2_f2.bin', 'sirio2_f4.bin', 'sirio2_f1.bin', 'sirio2_f3.bin'],
		},
		]
	},
	{
		// Mame name  'ataqandr'
		display_name: 'Ataque Androide - Moon Cresta (FAR S.A. Spanish bootleg)',
		developer: 'bootleg (FAR S.A.)',
		year: '1980?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['ataque_androide_p.bin'],
		},
		{
			name: 'PRG',
			roms: ['ataque_androide_1.bin', 'ataque_androide_2.bin', 'ataque_androide_3.bin', 'ataque_androide_4.bin', 'ataque_androide_5.bin', 'ataque_androide_6.bin', 'ataque_androide_7.bin', 'ataque_androide_8.bin'],
		},
		{
			name: 'BG',
			roms: ['ataque_androide_d.bin', 'ataque_androide_c.bin', 'ataque_androide_b.bin', 'ataque_androide_a.bin'],
		},
		]
	},
	{
		// Mame name  'sstarcrs'
		display_name: 'Super Star Crest',
		developer: 'bootleg (Taito do Brasil)',
		year: '1980?',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['ss1', 'ss2', 'ss3', 'ss4', 'ss5', 'ss6', 'ss7', 'ss8'],
		},
		{
			name: 'BG',
			roms: ['ss10', 'ss12', 'ss9', 'ss11'],
		},
		]
	},
	{
		// Mame name  'mooncmw'
		display_name: 'Moon War (Moon Cresta bootleg)',
		developer: 'bootleg',
		year: '198?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom-sn74s288n-71.6l'],
		},
		{
			name: 'PRG',
			roms: ['60.1x', '61.2x', '62.3x', '63.4x', '64.5x', '65.6x', '66.7x', '67.8x'],
		},
		{
			name: 'BG',
			roms: ['68.1h', '69.1k'],
		},
		]
	},
	{
		// Mame name  'starfgmc'
		display_name: 'Starfighter (Moon Cresta bootleg)',
		developer: 'bootleg (Samyra Engineering)',
		year: '198?',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom-sn74s288n-71.6l'],
		},
		{
			name: 'PRG',
			roms: ['sei-sf-a2.bin', 'sei-sf-a1.bin', 'sei-sf-b2.bin', 'sei-sf-c1.bin', 'sei-sf-d1.bin', 'sei-sf-e2.bin', 'sei-sf-f2.bin', 'sei-sf-f1.bin'],
		},
		{
			name: 'BG',
			roms: ['sei-sf-jh2.bin', 'sei-sf-jh3.bin', 'sei-sf-lk2.bin', 'sei-sf-lk3.bin'],
		},
		]
	},
	{
		// Mame name  'spcdrag'
		display_name: 'Space Dragon (Moon Cresta bootleg)',
		developer: 'bootleg',
		year: '1980',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['a.bin', 'b.bin', 'c.bin', 'd.bin', 'em.bin', 'fm.bin', 'g.bin', 'h.bin'],
		},
		{
			name: 'BG',
			roms: ['203.bin', '172.bin', '202.bin', '171.bin'],
		},
		]
	},
	{
		// Mame name  'floritas'
		display_name: 'Floritas (Moon Cresta bootleg)',
		developer: 'bootleg',
		year: '1980',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom_6331.10f'],
		},
		{
			name: 'PRG',
			roms: ['1.7g', '2.7g', '3.7g', '4.7g', '5.10g', '6.10g', '7.10g', '8.10g'],
		},
		{
			name: 'BG',
			roms: ['a2.7a', 'a4.7a', 'a1.9a', 'a3.9a'],
		},
		]
	},
	{
		// Mame name  'floritasm'
		display_name: 'Floritas (Multivideo Spanish Moon Cresta bootleg)',
		developer: 'bootleg (Multivideo)',
		year: '1980',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['6l-82s123.bin'],
		},
		{
			name: 'PRG',
			roms: ['rom1-2716.bin', 'rom2-2716.bin', 'rom3-2716.bin', 'rom4-2716.bin', 'rom5-2716.bin', 'rom6-2716.bin', 'rom7-2716.bin', 'rom8-2716.bin'],
		},
		{
			name: 'BG',
			roms: ['1h-2716.bin', '0h-2716.bin', '1k-2716.bin', '0k-2716.bin'],
		},
		]
	},
	{
		// Mame name  'mooncreg'
		display_name: 'Moon Cresta (Electrogame S.A. Spanish bootleg',
		developer: 'bootleg (Electrogame S.A.)',
		year: '1980',
		Notes: 'TODO: Missing roms?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom_6331.10f'],
		},
		{
			name: 'PRG',
			roms: ['eg1', 'eg2', 'eg3', 'eg4', 'eg5', 'eg6', 'eg7', 'eg8'],
		},
		{
			name: 'BG',
			roms: ['eg_2b', 'eg_4b', 'eg_1b', 'eg_3b'],
		},
		]
	},
	{
		// Mame name  'mooncreg2'
		display_name: 'Moon Cresta (Electrogame S.A. Spanish bootleg',
		developer: 'bootleg (Electrogame S.A.)',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mb7051.bin'],
		},
		{
			name: 'PRG',
			roms: ['1.bin', '2_bb.bin', '3.bin', '4_b.bin', '5.bin', '6.bin', '7_r.bin', '8.bin'],
		},
		{
			name: 'BG',
			roms: ['cm_2b.bin', 'cm_4.bin', 'cm_1b.bin', 'cm_3.bin'],
		},
		]
	},
	{
		// Mame name  'mooncrsl'
		display_name: 'Cresta Mundo (Laguna S.A. Spanish Moon Cresta bootleg)',
		developer: 'bootleg (Laguna S.A.)',
		year: '1980',
		Notes: '',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['mmi6331.6l'],
		},
		{
			name: 'PRG',
			roms: ['01.bin', '02.bin', '03.bin', '04.bin', '05.bin', '06.bin', '07.bin', '08.bin'],
		},
		{
			name: 'BG',
			roms: ['mcs_b', 'mcs_d', 'mcs_a', 'mcs_c'],
		},
		]
	},
	{
		// Mame name  'mooncrecm'
		display_name: 'Moon Cresta (Centromatic Spanish bootleg)',
		developer: 'bootleg (Centromatic)',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['prom.6l'],
		},
		{
			name: 'PRG',
			roms: ['mc1b.bin', 'mc2b.bin', 'mc3b.bin', 'mc4b.bin', 'mc5b.bin', 'mc6b.bin', 'mc7b.bin', 'mc8b.bin'],
		},
		{
			name: 'BG',
			roms: ['f2.bin', 'f4.bin', 'f1.bin', 'f3.bin'],
		},
		]
	},
	{
		// Mame name  'stera'
		display_name: 'Steraranger (Moon Cresta bootleg)',
		developer: 'bootleg',
		year: '1980',
		Notes: 'TODO: MISSING ROMS?',

		archive_name: 'mooncrst',
		driver: MoonCresta,
		mappings: [
		{
			name: 'RGB',
			roms: ['stera.6l'],
		},
		{
			name: 'PRG',
			roms: ['stera.1', 'stera.2', 'stera.3', 'stera.4', 'stera.5', 'stera.6', 'stera.7', 'stera.8'],
		},
		{
			name: 'BG',
			roms: ['stera.10', 'stera.12', 'stera.11', 'stera.9'],
		},
		]
	},
];
let ROM_INDEX = 0

console.log(RomSetInfo.length)

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
