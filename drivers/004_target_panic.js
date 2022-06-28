/*
 *
 *	Target Panic
 *
 */

import {seq, convertGFX, Timer} from '../libs/EMU.js/utils.js';
import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import Z80 from '../libs/EMU.js/devices/CPU/z80.js';
let game, sound;


class TargetPanic {
	cxScreen = 256;
	cyScreen = 256;
	width = 256;
	height = 256;
	xOffset = 0;
	yOffset = 0;
	rotate = 0;
	
	color_pal = 0

	fReset = true;

	fInterruptEnable = false;
	ram = new Uint8Array(0x4000).addBase();
	io = new Uint8Array(0x100);

	obj = new Uint8Array(0x4000).fill(1);
	rgb = Int32Array.of( 0xffffffff, 0xffff0000, 0xff00ff00, 0xff0000ff ); // placeholders
	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;
	objctrl = new Uint8Array(3);


	cpu = new Z80(Math.floor(9987000 / 3));
	timer = new Timer(60);

	constructor() {
		//Initialization around CPU
		for (let page = 0; page < 0x80; page++){
			this.cpu.memorymap[page].base = PRG.base[page];
		}
		
		for (let page = 0; page < 0x40; page++){
			this.cpu.memorymap[page+0x80].base  = this.ram.base[page];
			this.cpu.memorymap[page+0x80].write = null;
		}
		
		
		for (let i = 0; i < this.cpu.iomap.length; i++){
			this.cpu.iomap[i].write = (addr, data) => {
				console.log(i+" - "+addr+": "+data)
			};
			this.cpu.iomap[i].read = (addr) => {
				console.log(i+" - "+addr)
			};
		}
		
		this.cpu.iomap[0].write = (addr, data) => {
			this.color_pal = data; // color stuff?
			console.log("COL: - "+addr+": "+data)
		};
		this.cpu.iomap[0].read = (addr) => {
			return this.color_pal
		};
		
	}

	execute(audio, length) {
		const tick_rate = 192000
		const tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			this.cpu.execute(tick_rate);
			this.timer.execute(tick_rate, () => { update(), this.fInterruptEnable && this.cpu.interrupt(); });
			audio.execute(tick_rate);
		}
	}

	reset() {
		this.fReset = true;
	}

	updateStatus() {
		//Reset process
		if (this.fReset) {
			this.fReset = false;
			this.fInterruptEnable = false;
			this.ram.fill(0)
			this.io.fill(0)
			this.cpu.reset();
		}
		return this;
	}

	updateInput() {
		for (let i = 0; i < this.io.length; i++) {
			this.io[i] = 0xff
		}
		
		return this;
	}

	coin(fDown) {
		this.reset()
	}

	start1P(fDown) {
	}

	start2P(fDown) {
	}

	up(fDown) {
	}

	right(fDown) {
	}

	down(fDown) {
	}

	left(fDown) {
	}
	
	pal1bit( data ){
		return (((((data&0b100)*0xff)<<8)|((data&0b010)*0xff))<<8)|(0xff*(data&0b001))|0xff000000
	}
	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;
		
		//palette conversion
		this.rgb = Int32Array.of( 0xff000000, 0xffffffff, this.pal1bit( this.color_pal&0b111 ), this.pal1bit( (this.color_pal>>3)&0b111 ) );
		
		//video genration
		let p = 0;
		let val = 0;
		let y = 0;
		let x = 0;
		for (let offs = 0; offs < 0x2000; offs++){
			val = this.ram[offs];
			y = (offs & 0x7f) << 1;
			x = (offs >> 7) << 2;
			
			y = y*this.width;
			
			/* I'm guessing the hardware doubles lines? */
			this.bitmap[y+x+0           ] = this.rgb[val & 3];
			this.bitmap[y+x+0+this.width] = this.rgb[val & 3];
			val >>= 2;
			this.bitmap[y+x+1           ] = this.rgb[val & 3];
			this.bitmap[y+x+1+this.width] = this.rgb[val & 3];
			val >>= 2;
			this.bitmap[y+x+2           ] = this.rgb[val & 3];
			this.bitmap[y+x+2+this.width] = this.rgb[val & 3];
			val >>= 2;
			this.bitmap[y+x+3           ] = this.rgb[val & 3];
			this.bitmap[y+x+3+this.width] = this.rgb[val & 3];
		}

		return this.bitmap;
	}
}



const RBL = new RomBootLoader();

const RomSetInfo = [

	{
		// Mame name  'tgtpanic'
		display_name: 'Target Panic',
		developer: 'Konami',
		year: '1996',
		Notes: 'TODO:\nColors wrong,\nDoes it ever boot?',

		driver: TargetPanic,
		romsets: [
			{
				archive_name: 'tgtpanic',
				mappings: [
				{
					name: 'PRG',
					roms: ['601_ja_a01.13e'],
				},
				]
			},
		]
	},
	{
		// Mame name  n/a
		display_name: 'Target Panic - Homebrew Test',
		developer: 'nitrofurano ',
		year: '06-23-2015',
		Notes: 'Working: https://www.boriel.com/forum/showthread.php?tid=673',

		driver: TargetPanic,
		romsets: [
			{
				archive_name: 'target_panic_homebrew',
				archive_orign: './',
				mappings: [
				{
					name: 'PRG',
					roms: ['601_ja_a01.13e'],
				},
				]
			},
		]
	},
]


let ROM_INDEX = RomSetInfo.length-1
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+(ROM_INDEX+1))

let PRG, OBJ;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG = ROM["PRG"].addBase();
	
		game  = new ROM.settings.driver();
		sound = [];
		
		canvas.addEventListener('click', () => game.coin(true));
		init({game, sound});
		
	})
);
