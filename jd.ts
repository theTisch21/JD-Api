import { createClient } from 'redis'
import Hapi from '@hapi/hapi'
import Joi, { string } from 'joi'
import yaml from 'js-yaml'
import fs from 'fs'
(async () => {
	let redisAddr: string
	let host: string

	if (process.env.DOCKER == 'yes') {
		redisAddr = 'redis://172.28.0.4:6379'
		host = '0.0.0.0'
	} else {
		redisAddr = 'redis://localhost:6379'
		host = '0.0.0.0'
	}
	const database = createClient({
		url: redisAddr,
	})
	//Connect to redis database
	let databaseConnectPromise = database.connect().then(() => {
		server.log('database', 'Database connected!')
	})

	const server = Hapi.server({
		port: 3121,
		host: host,
		debug: {
			log: ['*'],
			request: ['*']
		}
	})

	//Utility
	function getNumberWithLeadingZero(num: number): string {
		if (num < 10) {
			return '0' + num.toString()
		}
		return num.toString()
	}

	function roundToLowerTen(num: number): number {
		while(num % 10 != 0) {
			num--;
		}
		return num
	}

	//Output the current contents to the console
	async function printDatabase() {
		let output = ""
		output += "====DATABASE====\n"
		let currentArea = 10
		//For each area
		while (currentArea < Number(await database.get("Area:Next"))) {
			output += `Area ${currentArea} ` + await database.get(`${currentArea}`) + "\n"
			let currentCategory = currentArea + 1

			//For each category
			while(await database.exists(`${currentCategory}`) != 0 && currentCategory < currentArea + 10) {
				output += `\tCategory ${currentCategory} ` + await database.get(`${currentCategory}`) + "\n"
				let currentItem = 1
				//For each item
				while (await database.exists(`${currentCategory}.${getNumberWithLeadingZero(currentItem)}`)) {
					output += `\t\tItem ${currentCategory}.${getNumberWithLeadingZero(currentItem)} ` + await database.get(`${currentCategory}.${getNumberWithLeadingZero(currentItem)}`) + "\n"
					currentItem++
				}
				output += "\n"
				currentCategory++
			}
			output += "\n"
			currentArea += 10
		}


		output += "=======END======="
		console.log(output)
	}

	//Add an area
	async function addArea(name: string) {
		console.log("Adding area " + name)
		let nextAreaNumber = Number(await database.get('Area:Next'))
		if (isNaN(nextAreaNumber))
			throw new Error('Database had invalid next area number')
		await database
			.multi()
			.incrBy('Area:Next', 10)
			.set(`${nextAreaNumber}`, name)
			.set(`${nextAreaNumber}:Next`, nextAreaNumber + 1)
			.exec()
		return nextAreaNumber
	}

	//Add a category
	async function addCategory(name: string, area: number): Promise<number> {
		console.log("Adding category " + name)
		area = roundToLowerTen(area)
		if(await database.exists(`${area}:Next`) == 0 || await database.exists(`${area}`) == 0) return -2 //Return -2 if the area doesn't exist
		let nextCategory = Number(await database.get(`${area}:Next`))
		let areaName = await database.get(`${area}`)
		if(isNaN(nextCategory)) throw new Error("Database had invalid next category for area " + area)
		if(nextCategory >= area + 10) return -1 //Return -1 if the new category is outside the 10 limit

		await database
		.multi()
		.incr(`${area}:Next`)
		.set(`${nextCategory}`, `${areaName} - ${name}`)
		.set(`${nextCategory}:Next`, 1)
		.exec()
		return nextCategory
	}

	//Add an item
	async function addItem(name: string, category: number) {
		console.log("Adding item " + name)
		if(await database.exists(`${category}`) == 0 || await database.exists(`${category}:Next`) == 0)  {return -2}
		let thisIdNumber = Number(await database.get(`${category}:Next`))
		if(isNaN(thisIdNumber)) throw new Error("Database had invalid next ID number")

		await database
		.multi()
		.incr(`${category}:Next`)
		.set(`${category}.${getNumberWithLeadingZero(thisIdNumber)}`, name)
		.exec()
		return `${category}.${getNumberWithLeadingZero(thisIdNumber)}`
	}

	//Test
	server.route({
		method: 'GET',
		path: '/',
		handler: async (Request, h) => {
			return "Hello there!"
		},
	})

	//Get areas
	server.route({
		method: 'GET',
		path: '/areas',
		handler: async (Request, h) => {
			let response = []
			let currentArea = 10
			//For each area
			while (currentArea < Number(await database.get("Area:Next"))) {
				response.push({
					id: currentArea, 
					name: await database.get(`${currentArea}`)
				})
				currentArea += 10
			}
			return JSON.stringify(response)
		}
	})

	//Get categories
	server.route({
		method: 'GET',
		path: '/{area}/categories',
		handler: async (Request, h) => {
			let response = []
			let currentArea = Number(Request.params.area)
			if(isNaN(currentArea)) return JSON.stringify([])
			currentArea = roundToLowerTen(currentArea)
			let currentCategory = currentArea + 1
			while(await database.exists(`${currentCategory}`) != 0 && currentCategory < currentArea + 10) {
				
				response.push({
					id: currentCategory, 
					name: await database.get(`${currentCategory}`)
				})
				currentCategory++
			}
			return JSON.stringify(response)
		}
	})

	//Get items
	server.route({
		method: 'GET',
		path: '/{category}/items',
		handler: async (Request, h) => {
			let response = []

			let currentCategory = Number(Request.params.category)
			if(isNaN(currentCategory)) return JSON.stringify([])

			let currentItem = 1
				//For each item
				while (await database.exists(`${currentCategory}.${getNumberWithLeadingZero(currentItem)}`)) {
					`\t\tItem ${currentCategory}.${getNumberWithLeadingZero(currentItem)}` + await database.get(`${currentCategory}.${getNumberWithLeadingZero(currentItem)}`) + "\n"
					response.push({
						id: `${currentCategory}.${getNumberWithLeadingZero(currentItem)}`,
						name: await database.get(`${currentCategory}.${getNumberWithLeadingZero(currentItem)}`)
					})
					currentItem++
				}


			return JSON.stringify(response)
		}
	})

	//Add area
	server.route({
		method: 'POST',
		path: '/new/area',
		handler: async (Request, h) => {
			let newName = (Request.payload as any).name
            console.log("Adding area: " + newName);
            let newId = await addArea(newName);
			printDatabase()
			
            return h.response({id: newId, message: `[OK] added area "${newName}" with id [${newId}]`}).code(200);
		}
	})

	//Add category
	server.route({
		method: 'POST',
		path: '/new/{area}/category',
		handler: async (Request, h) => {
			let newName = (Request.payload as any).name;
			
			console.log("Adding category: " + newName + " to area " + Request.params.area)
			
			if(isNaN(Number(Request.params.area))) return h.response({id: NaN, message: "[FAIL] Specified categry is not a number"}).code(401)
			
			let result = await addCategory(newName, Number(Request.params.area))

			if(result == -1) return h.response({id: NaN, message: "[FAIL] There are already too many categories in this area"}).code(500)
			if(result == -2) return h.response({id: NaN, message: "[FAIL] Area does not exist."}).code(400)
			return h.response({id: result, message: `[OK] added category "${newName}" with id [${result}]`}).code(200)
		}
	})

	//Add item
	server.route({
		method: 'POST',
		path: '/new/{category}/item',
		handler: async (Request, h) => {
			let newName = (Request.payload as any).name
			
			let category = Number(Request.params.category)
			if(isNaN(category)) return h.response({id: NaN, message: "[FAIL] Specified categry is not a number"}).code(401)

			console.log("Adding item: " + newName + " to category " + category)
			
			let result = await addItem(newName, category)

			if(result == -2) return h.response({id: NaN, message: "[FAIL] Category does not exist."}).code(400)

			return h.response({id: result, message: `[OK] added item "${newName}" with id [${result}]`}).code(200)
		}
	})

	//Initialize database
	await databaseConnectPromise
	await database.flushAll()
	if ((await database.exists('jd-db')) != 1) {
		server.log('database', 'Initializing database')
		await database.set('Area:Next', 10)
		//Grab initial config from init.yml file
		let config: any
		try {
			config = yaml.load(fs.readFileSync('./init.yml', 'utf-8'))			
		} catch (e) {
			config = {}
		}
		console.log(config)
		if(config.init) {		

			for (const area of config.areas) {
				console.log("Area " + area.name)
				

				let thisAreaId = await addArea(area.name)
				
				for (const category of area.categories) {
					console.log("Category " + category.name)
					

					let thisCategoryId = await addCategory(category.name, thisAreaId)
					
					for (const item of category.items) {
						console.log("Item " + item)
						

						await addItem(item, thisCategoryId)
					}
				}
			}
			
		}
		await database.set('jd-db', 'Initialized')
	} else {
		server.log('database', 'Database already initialized')
	}
	console.log("Database ready")
	printDatabase()

	//Start web server
	await server.start()
	console.log('Server running on %s', server.info.uri)

})()
