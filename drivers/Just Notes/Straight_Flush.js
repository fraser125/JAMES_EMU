
/*
 *
 *	Straight Flush
 *
 */


const RomSetInfo = [
	{
		// Mame name  'sflush'
		display_name: 'Straight Flush',
		developer: 'Taito',
		year: '1979',
		Notes: '~AUTO PORTED PLEASE TEST~',

		archive_name: 'sflush',
		driver: StraightFlush,
		mappings: [
		{
			name: 'PRG',
			roms: ['fr05.sc2', 'fr04.sc3', 'fr03.sc4', 'fr02.sc5', 'fr01.sc6'],
		},
		]
	},

]
