/*
 *
 *	Space Invaders
 *
 * TODO:
 *   ~ SV Version.
 *   ~ Space Invaders - Part 2.
 *   ~ Moon Base Zeta
 *   ~ 
 *   ~ 
 *   ~ 
 *   ~ 
 *   ~ +Other-Games.
 * 
 *   ~Sound.
 */

import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import I8080 from '../libs/EMU.js/devices/CPU/i8080.js';
let game, sound;

class SpaceInvaders_TV {
	cxScreen = 224;
	cyScreen = 256;
	width = 256;
	height = 256;
	xOffset = 0;
	yOffset = 0;
	rotate = 0;
	
	fTestButton = false;

	fReset = false;
	fDIPSwitchChanged = true;
	fCoin = 0;
	fStart1P = 0;
	fStart2P = 0;
	nStock = 3;
	nExtend = 1000;

	ram = new Uint8Array(0x2000).addBase();
	io = new Uint8Array(0x100);
	cpu_irq = false;
	cpu_irq2 = false;

	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;
	shifter = {shift: 0, reg: 0};
	screen_red = false;

	cpu = new I8080(Math.floor(19968000 / 10));
	scanline = {rate: 256 * 60, frac: 0, count: 0, execute(rate, fn) {
		for (this.frac += this.rate; this.frac >= rate; this.frac -= rate)
			fn(this.count = this.count + 1 & 255);
	}};

	constructor() {
		//SETUP CPU
		const range = (page, start, end, mirror = 0) => (page & ~mirror) >= start && (page & ~mirror) <= end;
		
		for (let page = 0; page <= 0x1f; page++){
			this.cpu.memorymap[page].base = PRG.base[page];
		}
		for (let page = 0x20; page <= 0x3f; page++){
			this.cpu.memorymap[page].base = this.ram.base[page & 0x1f];
			this.cpu.memorymap[page].write = null;
		}
		
		this.cpu.iomap.base = this.io;
		this.cpu.iomap.write = (addr, data) => {
			switch (addr) {
			case 0x00:
			case 0x01:
			case 0x02:
				return void(this.shifter.shift = data & 7);
			case 0x03:
//				check_sound3(this, data);
				return void(this.screen_red = (data & 4) !== 0);
			case 0x04:
				this.io[3] = data << this.shifter.shift | this.shifter.reg >> (8 - this.shifter.shift);
				return void(this.shifter.reg = data);
			case 0x05:
//				check_sound5(this, data);
				return;
			default:
				return void(this.io[addr] = data);
			}
		};

		this.cpu.check_interrupt = () => {
			if (this.cpu_irq && this.cpu.interrupt(0xd7)) //RST 10H
				return this.cpu_irq = false, true;
			if (this.cpu_irq2 && this.cpu.interrupt(0xcf)) //RST 08H
				return this.cpu_irq2 = false, true;
			return false;
		};
	}

	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			this.cpu.execute(tick_rate);
			this.scanline.execute(tick_rate, (vpos) => { vpos === 96 && (this.cpu_irq2 = true), vpos === 224 && (update(), this.cpu_irq = true); });
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
			switch (this.nStock) {
			case 3:
				this.io[2] &= ~3;
				break;
			case 4:
				this.io[2] = this.io[2] & ~3 | 1;
				break;
			case 5:
				this.io[2] = this.io[2] & ~3 | 2;
				break;
			case 6:
				this.io[2] |= 3;
				break;
			}
			switch (this.nExtend) {
			case 1000:
				this.io[2] |= 8;
				break;
			case 1500:
				this.io[2] &= ~8;
				break;
			}
			this.fReset = true;
		}

		//RESET
		if (this.fReset) {
			this.fReset = false;
			this.cpu_irq = this.cpu_irq2 = false;
			this.ram.fill(0);
			this.cpu.reset();
		}
		return this;
	}

	updateInput() {
		this.io[1] = this.io[1] & ~7 | !this.fCoin << 0 | !!this.fStart1P << 2 | !!this.fStart2P << 1;
		this.fCoin -= !!this.fCoin, this.fStart1P -= !!this.fStart1P, this.fStart2P -= !!this.fStart2P;
		this.io[0] = !this.fTestButton
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
		this.io[1] = this.io[1] & ~(1 << 6 | fDown << 5) | fDown << 6;
	}

	left(fDown) {
		this.io[1] = this.io[1] & ~(1 << 5 | fDown << 6) | fDown << 5;
	}

	triggerA(fDown) {
		this.io[1] = this.io[1] & ~(1 << 4) | fDown << 4;
	}

	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;
		
		const color = 0xffffffff;
		const back  = 0xff000000;

		for (let p = 256 * 8 * 31, k = 0x0400, i = 256 >> 3; i !== 0; --i) {
			for (let j = 224 >> 2; j !== 0; k += 0x80, p += 4, --j) {
				let a = this.ram[k];
				this.bitmap[p + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 256] = a & 0x40 ? color : back;
				this.bitmap[p] = a & 0x80 ? color : back;
				a = this.ram[k + 0x20];
				this.bitmap[p + 1 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 1 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 1 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 1 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 1 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 1 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 1 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 1] = a & 0x80 ? color : back;
				a = this.ram[k + 0x40];
				this.bitmap[p + 2 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 2 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 2 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 2 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 2 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 2 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 2 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 2] = a & 0x80 ? color : back;
				a = this.ram[k + 0x60];
				this.bitmap[p + 3 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 3 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 3 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 3 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 3 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 3 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 3 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 3] = a & 0x80 ? color : back;
			}
			k -= 0x20 * 224 - 1;
			p -= 224 + 256 * 8;
		}

		return this.bitmap;
	}
}

/*
 *
 *	Space Invaders - CV
 *
 */

class SpaceInvaders_CV extends SpaceInvaders_TV {
	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;

		const rgb = Int32Array.of(
			0xff000000, //black
			0xff0000ff, //red
			0xffff0000, //blue
			0xffff00ff, //magenta
			0xff00ff00, //green
			0xff00ffff, //yellow
			0xffffff00, //cyan
			0xffffffff, //white
		);

		for (let p = 256 * 8 * 31, k = 0x0400, i = 256 >> 3; i !== 0; --i) {
			for (let j = 224 >> 2; j !== 0; k += 0x80, p += 4, --j) {
				const color = rgb[this.screen_red ? 1 : MAP[k >> 3 & 0x3e0 | k & 0x1f] & 7]; // for color
				const back = rgb[0];
				let a = this.ram[k];
				this.bitmap[p + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 256] = a & 0x40 ? color : back;
				this.bitmap[p] = a & 0x80 ? color : back;
				a = this.ram[k + 0x20];
				this.bitmap[p + 1 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 1 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 1 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 1 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 1 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 1 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 1 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 1] = a & 0x80 ? color : back;
				a = this.ram[k + 0x40];
				this.bitmap[p + 2 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 2 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 2 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 2 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 2 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 2 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 2 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 2] = a & 0x80 ? color : back;
				a = this.ram[k + 0x60];
				this.bitmap[p + 3 + 7 * 256] = a & 1 ? color : back;
				this.bitmap[p + 3 + 6 * 256] = a & 2 ? color : back;
				this.bitmap[p + 3 + 5 * 256] = a & 4 ? color : back;
				this.bitmap[p + 3 + 4 * 256] = a & 8 ? color : back;
				this.bitmap[p + 3 + 3 * 256] = a & 0x10 ? color : back;
				this.bitmap[p + 3 + 2 * 256] = a & 0x20 ? color : back;
				this.bitmap[p + 3 + 256] = a & 0x40 ? color : back;
				this.bitmap[p + 3] = a & 0x80 ? color : back;
			}
			k -= 0x20 * 224 - 1;
			p -= 224 + 256 * 8;
		}

		return this.bitmap;
	}
}


/*
 *
 *	Space Invaders - SV
 *
 */

class SpaceInvaders_SV extends SpaceInvaders_TV {
	// TODO!
}

/*
 *
 *	Space Invaders: Part 2
 *
 */

class SpaceInvaders_Part2 extends SpaceInvaders_TV {
	updateInput() {
		this.io[1] = 0xff
		this.io[0] = 0xff
		return this;
	}
}

/*
 *
 *	Space Ranger
 *  [all this does is rotate the screen 180o]
 */

class BootLeg_SpaceRanger extends SpaceInvaders_CV {
	rotate = 2;
}

/*
 *
 *	Astropal
 *  TODO: ADD INPUTS
 */
class Astropal extends SpaceInvaders_TV {
}

 

/*
 *
 *	Space Invaders
 *
 */
const RBL = new RomBootLoader();

const RomSetInfo = [
/*
	{
		// Mame name  'sisv1'
		display_name: 'Space Invaders (SV Version rev 1)',
		developer: 'Taito',
		year: '1978',
		Notes: 'UNDUMPED?',

		archive_name: 'invaders',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['sisv1/sv01.36', 'sv02.35', 'sv03.34', 'sv04.31', 'sv05.42', 'sv06.41'],
		},
		]
	},
	{
		// Mame name  'sisv2'
		display_name: 'Space Invaders (SV Version rev 2)',
		developer: 'Taito',
		year: '1978',
		Notes: 'TODO: Will not boot.',

		archive_name: 'invaders',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['sisv1/sv01.36', 'sv02.35', 'sv10.34', 'sv04.31', 'sv09.42', 'sv06.41'],
		},
		]
	},
	{
		// Mame name  'sisv3'
		display_name: 'Space Invaders (SV Version rev 3)',
		developer: 'Taito',
		year: '1978',
		Notes: 'TODO: Will not boot.',

		archive_name: 'invaders',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['sv0h.36', 'sv02.35', 'sv10.34', 'sv04.31', 'sv09.42', 'sv06.41'],
		},
		]
	},
	{
		// Mame name  'sisv'
		display_name: 'Space Invaders (SV Version rev 4)',
		developer: 'Taito',
		year: '1978',
		Notes: 'TODO: Will not boot.',

		archive_name: 'invaders',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['sv0h.36', 'sv11.35', 'sv12.34', 'sv04.31', 'sv13.42', 'sv14.41'],
		},
		]
	},
*/
	
	{
		// Mame name  'sicv'
		display_name: 'Space Invaders (CV Version, Larger roms)',
		developer: 'Taito',
		year: '1979',
		Notes: '',

		archive_name: 'invaders',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv01.1', 'cv02.2'],
		},
		{
			name: 'PRG',
			roms: ['cv17.36', 'cv18.35', 'cv19.34', 'cv20.33'],
		},
		]
	},
	{
		// Mame name  'sicv1'
		display_name: 'Space Invaders (CV Version, smaller roms)',
		developer: 'Taito',
		year: '1979',
		Notes: 'TODO: Fails to boot',

		archive_name: 'invaders',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv01.1', 'cv02.2'],
		},
		{
			name: 'PRG',
			roms: ['cv11.s1', 'cv12.r1', 'cv13.np1', 'cv14.jk1', 'cv15.i1', 'cv16.g1'],
		},
		]
	},
	{
		// Mame name  'spcewarla'
		display_name: 'Space War (Leisure and Allied)',
		developer: 'bootleg (Leisure and Allied)',
		year: '1979',
		Notes: '',

		archive_name: 'invaders',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv01_1.bin', 'cv02_2.bin'],
		},
		{
			name: 'PRG',
			roms: ['ps1.bin', 'ps2.bin', 'ps3.bin', 'ps4.bin', 'ps5.bin', 'ps6.bin', 'ps7.bin', 'ps8.bin', 'ps9.bin'],
		},
		]
	},
	{
		// Mame name  'spacerng'
		display_name: 'Space Ranger',
		developer: 'bootleg (Leisure Time Electronics)',
		year: '1978',
		Notes: '~AUTO PORTED PLEASE TEST~',

		archive_name: 'invaders',
		driver: BootLeg_SpaceRanger,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv01.1', 'cv02.2'],
		},
		{
			name: 'PRG',
			roms: ['sr1.u36', 'sr2.u35', 'sr3.u34', 'sr4.u33'],
		},
		]
	},
	/*{
		// Mame name  'invadpt2'
		display_name: 'Space Invaders Part II (Taito',
		developer: 'Taito',
		year: '1979',
		Notes: 'TODO: DOES NOT BOOT',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_Part2,
		mappings: [
		{
			name: 'MAP',
			roms: ['pv06.1', 'pv07.2'],
		},
		{
			name: 'PRG',
			roms: ['pv01', 'pv02', 'pv03', 'pv04', 'pv05'],
		},
		]
	},
	{
		// Mame name  'invadpt2a'
		display_name: 'Space Invaders Part II (Taito',
		developer: 'Taito',
		year: '1979',
		Notes: 'TODO: DOES NOT BOOT',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['pv06.1', 'pv07.2'],
		},
		{
			name: 'PRG',
			roms: ['uv01.36', 'uv02.35', 'uv03.34', 'uv04.33', 'uv05.32', 'uv06.31', 'uv07.42', 'uv08.41', 'uv09.40', 'uv10.39'],
		},
		]
	},
	{
		// Mame name  'invadpt2br'
		display_name: 'Space Invaders Part II (Brazil)',
		developer: 'Taito do Brasil',
		year: '1979',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['pv06.1', 'pv07.2'],
		},
		{
			name: 'PRG',
			roms: ['pv01', 'br_pv02', 'br_pv03', 'br_pv04', 'br_pv05'],
		},
		]
	},
	{
		// Mame name  'moonbase'
		display_name: 'Moon Base Zeta (set 1)',
		developer: 'Taito / Nichibutsu',
		year: '1979',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv02.h7', 'cv01.g7'],
		},
		{
			name: 'PRG',
			roms: ['ze3-1.a4', 'ze3-2.c4', 'ze3-3.e4', 'ze3-4.f4', 'ze3-5.h4', 'ze3-6.l4', 'ze3-7.a5', 'ze3-8.c5', 'ze3-9.e5', 'ze3-10.f5'],
		},
		]
	},
	{
		// Mame name  'moonbasea'
		display_name: 'Moon Base Zeta (set 2)',
		developer: 'Taito / Nichibutsu',
		year: '1979',
		Notes: 'TODO: DOES NOT BOOT',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['cv02.h7', 'cv01.g7'],
		},
		{
			name: 'PRG',
			roms: ['ze3-1.a4', 'ze3-2.c4', 'ze3-3.e4', 'ze3-4_alt.f4', 'ze3-5.h4', 'ze3-6.l4', 'ze3-7.a5', 'ze3-8.c5', 'ze3-9.e5', 'ze3-10.f5'],
		},
		]
	},
	{
		// Mame name  'invaddlx'
		display_name: 'Space Invaders Deluxe',
		developer: 'Taito (Midway license)',
		year: '1980',
		Notes: 'TODO: DOES NOT BOOT (same as Part2??)',

		archive_name: 'invadpt2',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['invdelux.h', 'invdelux.g', 'invdelux.f', 'invdelux.e', 'invdelux.d'],
		},
		]
	},*/
	
//// Not Space Invaders ////
	
	{
		// Mame name  'spcewarl'
		display_name: 'Space War (Leijac Corporation)',
		developer: 'Leijac Corporation',
		year: '1979',
		Notes: '',

		archive_name: 'spcewarl',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['01.1', '02.2'],
		},
		{
			name: 'PRG',
			roms: ['spcewarl.1', 'spcewarl.2', 'spcewarl.3', 'spcewarl.4'],
		},
		]
	},
	{
		// Mame name  'spclaser'
		display_name: 'Space Laser',
		developer: 'Taito',
		year: '1980',
		Notes: '',

		archive_name: 'spcewarl',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['01.1', '02.2'],
		},
		{
			name: 'PRG',
			roms: ['la01', /*'la02'*/ 'spcewarl.2', 'la03', 'la04'],
		},
		]
	},
	{
		// Mame name  'intruder'
		display_name: 'Intruder',
		developer: 'Taito (Game Plan license)',
		year: '1980',
		Notes: '',

		archive_name: 'spcewarl',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['01.1', '02.2'],
		},
		{
			name: 'PRG',
			roms: ['la01-1.36', /*'la02-1.35'*/ 'spcewarl.2', 'la03-1.34', 'la04-1.33'],
		},
		]
	},
	{
		// Mame name  'laser'
		display_name: 'Astro Laser (bootleg of Space Laser)',
		developer: 'bootleg (Leisure Time Electronics)',
		year: '1980',
		Notes: '',

		archive_name: 'spcewarl',
		driver: SpaceInvaders_CV,
		mappings: [
		{
			name: 'MAP',
			roms: ['01.1', '02.2'],
		},
		{
			name: 'PRG',
			roms: ['la01', /*'la02'*/ 'spcewarl.2', 'la03', 'la04'],
		},
		]
	},
	{
		// Mame name  'orbite'
		display_name: 'Orbite (prototype)',
		developer: 'Model Racing',
		year: '1979?',
		Notes: 'TODO: No sprites no color',

		archive_name: 'orbite',
		driver: SpaceInvaders_TV,
		mappings: [
		{
			name: 'PRG',
			roms: ['mrxx.71', 'mrxx.70', 'mrxx.69'],
		},
		]
	},
	{
		// Mame name  'astropal'
		display_name: 'Astropal',
		developer: 'Sidam?',
		year: '1980?',
		Notes: 'TODO: Controls',

		archive_name: 'astropal',
		driver: Astropal,
		mappings: [
		{
			name: 'PRG',
			roms: ['2708.0a', '2708.1a', '2708.2a', '2708.3a', '2708.4a', '2708.5a', '2708.6a', '2708.7a'],
		},
		]
	},

]


let ROM_INDEX = RomSetInfo.length-1
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+(ROM_INDEX+1))

let PRG, MAP;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG = ROM["PRG"].addBase();
		if ("MAP" in ROM){
			console.log("HAS COLOR!")
			MAP = ROM["MAP"].addBase(); // for color
		}
		game  = new ROM.settings.driver();
		sound = [];
		
		init({game, sound});
		
	})
);

