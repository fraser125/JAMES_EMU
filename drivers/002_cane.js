
/*
 *
 *	Cane [unreleased]
 *  TODO:
 *     Fix video
 *     Add Shooting
 */

import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import I8080 from '../libs/EMU.js/devices/CPU/i8080.js';
let game, sound;

class Cane {
	cxScreen = 224;
	cyScreen = 256;
	width = 256;
	height = 256;
	xOffset = 0;
	yOffset = 0;
	rotate = 1

	fReset = true;
	fDIPSwitchChanged = true;
	fCoin = 0;
	fStart1P = 0;
	fStart2P = 0;
	nStock = 3;
	nExtend = 1000;

	ram = new Uint8Array(0x20000).addBase();
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
	shift = 0;

	constructor() {
		//SETUP CPU
		const range = (page, start, end, mirror = 0) => (page & ~mirror) >= start && (page & ~mirror) <= end;
		
		for (let page = 0; page <= 0x1f; page++){
			this.cpu.memorymap[page].base = PRG.base[page];
		}
		for (let page = 0x20; page <= 0xef; page++){
			this.cpu.memorymap[page].base = this.ram.base[page & 0x1f];
			this.cpu.memorymap[page].write = null;
		}
		
		this.cpu.iomap.base = this.io;
		this.cpu.iomap.write = (addr, data) => {
			switch (addr) {
			case 0x02:
				this.shifter.shift = data;
			default:
				this.io[addr] = data;
			}
		};
		this.cpu.iomap.read = (addr) => {
			if (0x03)
				return this.shifter.shift;
			else
				return this.io[addr];
			
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
 *	Cane - prototype
 *
 */
const RBL = new RomBootLoader();

const RomSetInfo = [
	{
		// Mame name  'cane'
		display_name: 'Cane (prototype)',
		developer: 'Model Racing',
		year: '1979?',
		Notes: '~AUTO PORTED PLEASE TEST~',

		archive_name: 'cane',
		driver: Cane,
		mappings: [
		{
			name: 'PRG',
			roms: ['mrcane.71', 'mrcane.70', 'mrcane.69', 'mrcane.62'],
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

