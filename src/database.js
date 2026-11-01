import {
    ObjectId,
    dotNotationToObject,
    searchData,
    isValidDate
} from "@cocreate/utils";

import { 
    dbClient, 
    createData,
    errorHandler 
} from "./utilities.js";

/**
 * "database" operations mapped to SQL Catalogs.
 * @private
 * @environment server
 */
function database(method, data) {
	return new Promise(
		async (resolve, reject) => {
			let type = "database";
			let databaseArray = [];

			try {
				const pool = await dbClient(data);
				if (!pool || pool.status === false) return resolve(data);

				if (method === "read") {
					const sql = "SELECT datname FROM pg_database WHERE datistemplate = false;";
					
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
						const dbObj = { name: row.datname };
						if (data.filter && data.filter.query) {
							let isFilter = queryData(dbObj, data.filter.query);
							if (isFilter)
								databaseArray.push({
									database: dbObj,
									storage: data.storageConfig?.name
								});
						} else {
							databaseArray.push({
								database: dbObj,
								storage: data.storageConfig?.name
							});
						}
					}
					resolve(createData(data, databaseArray, type));
				}
				if (method === "delete") {
					const dbName = data.database;
					const sql = `DROP DATABASE IF EXISTS "${dbName}";`;
					
					process.emit("usage", {
						type: "egress",
						data: { sql },
						organization_id: data.organization_id
					});
					
					const result = await pool.query(sql);
					
					process.emit("usage", {
						type: "ingress",
						data: result,
						organization_id: data.organization_id
					});
					resolve(result);
				}
			} catch (error) {
				errorHandler(data, error);
				console.log(method, "error", error);
				resolve(data);
			}
		}
	);
}

export default database