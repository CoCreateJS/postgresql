import {
    ObjectId,
    dotNotationToObject,
    searchData,
    isValidDate
} from "@cocreate/utils";

import { 
    dbClient, 
    createFilter, 
    createData,
    errorHandler 
} from "./utilities.js";

/**
 * "array" operations mapped to SQL Tables.
 */
function array(method, data) {
	return new Promise(
		async (resolve, reject) => {
			let type = "array";
			let arrayArray = []; 

			try {
				const pool = await dbClient(data);
				if (!pool || pool.status === false) return resolve(data);

				if (data.request) data.array = data.request;

				let databases = data.database;
				if (!Array.isArray(databases)) databases = [databases];

				let databasesLength = databases.length;
				for (let database of databases) {
					if (method === "read") {
						const sql = `
							SELECT table_name 
							FROM information_schema.tables 
							WHERE table_schema = 'public';
						`;
						
						process.emit("usage", {
							type: "egress",
							data: { sql },
							organization_id: data.organization_id
						});

						const res = await pool.query(sql);
						
						process.emit("usage", {
							type: "ingress",
							data: res.rows,
							organization_id: data.organization_id
						});

						for (let row of res.rows) {
							const tableObj = { name: row.table_name };
							if (data.$filter && data.$filter.query) {
								let isFilter = queryData(tableObj, data.$filter.query);
								if (isFilter)
									arrayArray.push({
										name: row.table_name,
										database,
										storage: data.storageConfig?.name
									});
							} else {
								arrayArray.push({
									name: row.table_name,
									database,
									storage: data.storageConfig?.name
								});
							}
						}
						
						databasesLength -= 1;
						if (!databasesLength) {
							data = createData(data, arrayArray, type);
							resolve(data);
						}
					} else {
						let arrays = data.array;
						if (method === "update") arrays = Object.entries(data.array);
						if (!Array.isArray(arrays)) arrays = [arrays];

						let arraysLength = arrays.length;
						for (let array of arrays) {
							if (method === "create") {
								const sql = `
									CREATE TABLE IF NOT EXISTS "${array}" (
										_id VARCHAR(50) PRIMARY KEY,
										organization_id VARCHAR(50),
										data JSONB DEFAULT '{}'::jsonb,
										created JSONB,
										modified JSONB
									);
								`;
								
								process.emit("usage", {
									type: "egress",
									data: { sql },
									organization_id: data.organization_id
								});

								await pool.query(sql);
								arrayArray.push({
									name: array,
									database,
									storage: data.storageConfig?.name
								});

								arraysLength -= 1;
								if (!arraysLength) databasesLength -= 1;
								if (!databasesLength && !arraysLength) {
									data = createData(data, arrayArray, type);
									resolve(data);
								}
							} else {
								if (method === "update") {
									let [oldName, newName] = array;
									const sql = `ALTER TABLE "${oldName}" RENAME TO "${newName}";`;
									
									process.emit("usage", {
										type: "egress",
										data: { sql },
										organization_id: data.organization_id
									});

									await pool.query(sql);
									arrayArray.push({
										name: newName,
										oldName: oldName,
										database,
										storage: data.storageConfig?.name
									});

									arraysLength -= 1;
									if (!arraysLength) databasesLength -= 1;
									if (!databasesLength && !arraysLength) {
										data = createData(data, arrayArray, type);
										resolve(data);
									}
								}

								if (method === "delete") {
									const sql = `DROP TABLE IF EXISTS "${array}" CASCADE;`;
									
									process.emit("usage", {
										type: "egress",
										data: { sql },
										organization_id: data.organization_id
									});

									await pool.query(sql);
									arrayArray.push({
										name: array,
										database,
										storage: data.storageConfig?.name
									});

									arraysLength -= 1;
									if (!arraysLength) databasesLength -= 1;
									if (!databasesLength && !arraysLength) {
										data = createData(data, arrayArray, type);
										resolve(data);
									}
								}
							}
						}
					}
				}
			} catch (error) {
				errorHandler(data, error);
				console.log(method, "error", error);
				resolve(data);
			}
		}
	);
}

export default array