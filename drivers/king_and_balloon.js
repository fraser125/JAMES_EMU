/*
 *
 *	King & Balloon
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

const HELP     = new Int16Array(0x700 * 2 + 0x1200);
const THANKYOU = new Int16Array(0x800 * 2);
const BYEBYE   = new Int16Array(0x800 * 2);

class KingAndBalloon {
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
	nKing = 3;
	nBonus = 'A';
	fVoice = true;

	fInterruptEnable = false;
	ram = new Uint8Array(0x900).addBase();
	mmo = new Uint8Array(0x100);
	ioport = new Uint8Array(0x100);

	bg = new Uint8Array(0x4000).fill(3);
	obj = new Uint8Array(0x4000).fill(3);
	rgb = Int32Array.from(RGB, e => 0xff000000 | (e >> 6) * 255 / 3 << 16 | (e >> 3 & 7) * 255 / 7 << 8 | (e & 7) * 255 / 7);
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;

	BOMB = sound[0].samples.BOMB;
	SHOT = sound[0].samples.SHOT;
	WAVE = sound[0].samples.WAVE1111;
	se = [this.BOMB, this.SHOT, this.WAVE, HELP, THANKYOU, BYEBYE].map(buf => ({freq: 11025, buf, loop: false, start: false, stop: false}));

	cpu = new Z80(Math.floor(18432000 / 6));
	timer = new Timer(60);

	constructor() {
		this.ioport[0x10] = 0x40;

		//SETUP CPU
		for (let i = 0; i < 0x28; i++)
			this.cpu.memorymap[i].base = PRG.base[i];
		for (let i = 0; i < 4; i++) {
			this.cpu.memorymap[0x80 + i].base = this.ram.base[i];
			this.cpu.memorymap[0x80 + i].write = null;
			this.cpu.memorymap[0x90 + i].base = this.ram.base[4 + i];
			this.cpu.memorymap[0x90 + i].write = null;
		}
		this.cpu.memorymap[0x98].base = this.ram.base[8];
		this.cpu.memorymap[0x98].write = null;
		this.cpu.memorymap[0xa0].base = this.ioport;
		this.cpu.memorymap[0xa0].write = (addr, data) => {
			if ((addr & 7) === 4)
				data & 1 ? (this.se[2].start = true) : (this.se[2].stop = true);
			this.mmo[addr & 7] = data & 1;
		};
		this.cpu.memorymap[0xa8].base = this.ioport.subarray(0x10);
		this.cpu.memorymap[0xa8].write = (addr, data) => {
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
		this.cpu.memorymap[0xb0].base = this.ioport.subarray(0x20);
		this.cpu.memorymap[0xb0].write = (addr, data) => {
			switch (addr & 7) {
			case 1:
				this.fInterruptEnable = (data & 1) !== 0;
				break;
			case 2:
				//VOICE OUTPUT
				//mmo[0x20] : VOICE NO.
				//			 $01 HELP!
				//			 $02 THANK YOU!
				//			 $03 BYE BYE!
				this.se[3].stop = this.se[4].stop = this.se[5].stop = true;
				switch (this.mmo[0x20]) {
				case 1:
					this.se[3].start = true;
					break;
				case 2:
					this.se[4].start = true;
					break;
				case 3:
					this.se[5].start = true;
					break;
				}
				break;
			case 3:
				if (data & 1)
					this.ioport[0x30] = this.fVoice ? 0x40 : 0, this.cpu.memorymap[0xa0].base = this.ioport.subarray(0x30);
				else
					this.cpu.memorymap[0xa0].base = this.ioport;
				break;
			case 4:
				sound[0].control(data & 1);
				break;
			}
			this.mmo[addr & 7 | 0x20] = data;
		};
		this.cpu.memorymap[0xb8].write = (addr, data) => { sound[0].set_reg30(data), this.mmo[0x30] = data; }; //SOUND FREQUENCY

		//SETUP VIDEO
		convertGFX(this.bg, BG, 256, rseq(8, 0, 8), seq(8), [0, BG.length * 4], 8);
		convertGFX(this.obj, BG, 64, rseq(8, 128, 8).concat(rseq(8, 0, 8)), seq(8).concat(seq(8, 64)), [0, BG.length * 4], 32);

		//効果音の初期化
		KingAndBalloon.convertVOICE();
		this.se[3].freq = this.se[4].freq = this.se[5].freq = 5000;
		this.se[2].loop = this.se[3].loop = true;
	}

	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			this.cpu.execute(tick_rate);
			this.timer.execute(tick_rate, () => { update(), this.fInterruptEnable && this.cpu.non_maskable_interrupt(); });
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
			switch (this.nKing) {
			case 2:
				this.ioport[0x20] &= ~4;
				break;
			case 3:
				this.ioport[0x20] |= 4;
				break;
			}
			switch (this.nBonus) {
			case 'A':
				this.ioport[0x20] &= ~3;
				break;
			case 'B':
				this.ioport[0x20] = this.ioport[0x20] & ~3 | 1;
				break;
			case 'C':
				this.ioport[0x20] = this.ioport[0x20] & ~3 | 2;
				break;
			case 'NONE':
				this.ioport[0x20] |= 3;
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

	updateInput() {
		this.ioport[0] = this.ioport[0] & ~(1 << 0) | !!this.fCoin << 0;
		this.ioport[0x10] = this.ioport[0x10] & ~3 | !!this.fStart1P << 0 | !!this.fStart2P << 1;
		this.fCoin -= !!this.fCoin, this.fStart1P -= !!this.fStart1P, this.fStart2P -= !!this.fStart2P;
		this.ioport[0x10] ^= 1 << 5; //tricky!!!
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

	static convertVOICE() {
		//Help !
		let i = 0;
		for (let j = 0x700, k = 0x100; j !== 0; --j) {
			HELP[i++] = (VOICE[k] >> 4) - 8 << 10;
			HELP[i++] = (VOICE[k++] & 0xf) - 8 << 10;
		}
		for (let j = 0x1200; j !== 0; --j)
			HELP[i++] = 0;

		//Thank you !
		i = 0;
		for (let j = 0x800, k = 0x800; j !== 0; --j) {
			THANKYOU[i++] = (VOICE[k] >> 4) - 8 << 10;
			THANKYOU[i++] = (VOICE[k++] & 0xf) - 8 << 10;
		}

		//Bye bye !
		i = 0;
		for (let j = 0x800, k = 0x1000; j !== 0; --j) {
			BYEBYE[i++] = (VOICE[k] >> 4) - 8 << 10;
			BYEBYE[i++] = (VOICE[k++] & 0xf) - 8 << 10;
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
		for (let k = 0x85c, i = 8; i !== 0; k -= 4, --i) {
			const x = this.ram[k] - (i < 4), y = this.ram[k + 3] + 16;
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
			this.bitmap[p + 0x300] = this.bitmap[p + 0x200] = this.bitmap[p + 0x100] = this.bitmap[p] = i > 6 ? 5 : 6;
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
 *	King & Balloon
 *
 */



const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		display_name: 'King & Balloon (US)',
		developer: 'Namco',
		year: '1980',
		Notes: '',

		archive_name: 'kingball',
		driver: KingAndBalloon,
		mappings: [
			{
				name: 'PRG',
				roms: ["prg1.7f", "prg2.7j", "prg3.7l"],
			},
			{
				name: 'VOICE',
				roms: ["kbe1.ic4", "kbe2.ic5", "kbe3.ic6", "kbe2.ic7"],
			},
			{
				name: 'BG',
				roms: ["chg1.1h", 'chg2.1k'],
			},
			{
				name: 'RGB',
				roms: ['kb2-1'],
			},
		],
	},
	{
		display_name: 'King & Balloon (JAPAN)',
		developer: 'Namco',
		year: '1980',
		Notes: '',

		archive_name: 'kingball',
		driver: KingAndBalloon,
		mappings: [
			{
				name: 'PRG',
				roms: ["prg1.7f", "prg2.7j", "prg3.7l"],
			},
			{
				name: 'VOICE',
				roms: ["kbj1.ic4", "kbj2.ic5", "kbj3.ic6", "kbj2.ic7"], // only these rom chips are difrent in the japanese version
			},
			{
				name: 'BG',
				roms: ["chg1.1h", 'chg2.1k'],
			},
			{
				name: 'RGB',
				roms: ['kb2-1'],
			},
		],
	},
];

let BG, RGB, PRG, VOICE;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[1]).then((ROM) => {
		console.log(ROM)
		VOICE = ROM["VOICE"];
		PRG   = ROM["PRG"  ].addBase();
		BG    = ROM["BG"   ];
		RGB   = ROM["RGB"  ];
		
		sound.push( new GalaxianSound() )
		game    =   new ROM.settings.driver();
		sound.push( new SoundEffect({se: game.se, gain: 0.5}) )
		
		canvas.addEventListener('click', () => game.coin(true));
		init({game, sound});
		
	})
);
