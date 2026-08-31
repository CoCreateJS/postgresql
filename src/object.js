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
 * "object" operations mapped to SQL Rows.
 */
function object(method, data) {
	return new Promise(
		async (resolve, reject) => {
			try {
				const pool = await dbClient(data);
				if (!pool || pool.status === false) return resolve(data);

				let type = "object";
				let documents = [];

				if (!data["timeStamp"])
					data["timeStamp"] = new Date().toISOString();

				let databases = data.database;
				if (!Array.isArray(databases)) databases = [databases];

				for (let database of databases) {
					let arrays = data.array;
					if (!Array.isArray(arrays)) arrays = [arrays];

					for (let array of arrays) {
						const reference = {
							$storage: data.storageConfig?.name,
							$database: database,
							$array: array
						};

						if (!data[type]) data[type] = [];
						else if (typeof data[type] === "string")
							data[type] = [{ _id: data[type] }];
						else if (!Array.isArray(data[type]))
							data[type] = [data[type]];

						let isFilter = !!data.filter;
						if ((isFilter && !data[type].length) || data.isFilter) {
							data[type].splice(0, 0, { isFilter: "isEmptyObjectFilter" });
						}

						for (let i = 0; i < data[type].length; i++) {
							let $storage = data[type][i].$storage || [];
							let $database = data[type][i].$database || [];
							let $array = data[type][i].$array || [];

							if (!Array.isArray($storage)) $storage = [data[type][i].$storage];
							if (!Array.isArray($database)) $database = [data[type][i].$database];
							if (!Array.isArray($array)) $array = [data[type][i].$array];

							if (!$storage.includes(data.storageConfig?.name)) $storage.push(data.storageConfig?.name);
							if (!$database.includes(database)) $database.push(database);
							if (!$array.includes(array)) $array.push(array);

							delete data[type][i].$storage;
							delete data[type][i].$database;
							delete data[type][i].$array;

							let queryFilter = isFilter ? data.filter : (data[type][i].filter || null);
							let { sqlWhere, params } = compileFilterToSQL(queryFilter, data.organization_id);

							if (method === "create") {
								data[type][i] = replaceArray(data[type][i]);
								data[type][i] = dotNotationToObject(data[type][i]);
								
								const id = data[type][i]._id || `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
								const orgId = data.organization_id;
								const created = {
									on: new Date(data.timeStamp),
									by: data.user_id || data.clientId
								};
								
								const recordPayload = { ...data[type][i] };
								delete recordPayload._id;
								delete recordPayload.organization_id;

								const sql = `
									INSERT INTO "${array}" (_id, organization_id, data, created, modified)
									VALUES ($1, $2, $3, $4, NULL)
									RETURNING *;
								`;
								const queryParams = [id, orgId, JSON.stringify(recordPayload), JSON.stringify(created)];
								
								process.emit("usage", {
									type: "egress",
									data: { sql, queryParams },
									organization_id: data.organization_id
								});
								const result = await pool.query(sql, queryParams);
								
								process.emit("usage", {
									type: "ingress",
									data: result.rows,
									organization_id: data.organization_id
								});

								if (result.rows.length > 0) {
									const formattedDoc = parseSqlRow(result.rows[0]);
									data[type][i] = { ...formattedDoc, $storage, $database, $array };
								}
							}
							else if (method === "read") {
								let sql = `SELECT * FROM "${array}" ${sqlWhere}`;
								
								if (data.filter && data.filter.sort) {
									const sortClauses = data.filter.sort.map(s => {
										let dir = s.direction === -1 || s.direction === 'desc' ? 'DESC' : 'ASC';
										if (["_id", "organization_id"].includes(s.key)) {
											return `"${s.key}" ${dir}`;
										}
										return `(data->>'${s.key}') ${dir}`;
									});
									sql += ` ORDER BY ${sortClauses.join(', ')}`;
								}
								if (data.filter && typeof data.filter.limit === 'number') {
									sql += ` LIMIT ${data.filter.limit}`;
								}
								if (data.filter && typeof data.filter.index === 'number') {
									sql += ` OFFSET ${data.filter.index}`;
								}

								if (data[type][i]._id && !isFilter) {
									sql = `SELECT * FROM "${array}" WHERE _id = $1 AND organization_id = $2`;
									params = [data[type][i]._id, data.organization_id];
								}

								process.emit("usage", {
									type: "egress",
									data: { sql, params },
									organization_id: data.organization_id
								});
								const result = await pool.query(sql, params);
								
								process.emit("usage", {
									type: "ingress",
									data: result.rows,
									organization_id: data.organization_id
								});

								if (isFilter) {
									for (let row of result.rows) {
										const parsedRow = parseSqlRow(row);
										if (data.filter && data.filter.search) {
											let isMatch = searchData(parsedRow, data.filter.search);
											if (!isMatch) continue;
										}
										documents.push({
											...parsedRow,
											...reference
										});
									}
								} else if (result.rows.length > 0) {
									let dbRecord = parseSqlRow(result.rows[0]);
									
									if ($storage.length && data[type][i].modified && data[type][i].modified.on) {
										let clientTime = new Date(data[type][i].modified.on);
										let dbTime = new Date(dbRecord.modified ? dbRecord.modified.on : 0);
										
										if (clientTime > dbTime) {
											const updatedRecord = { ...dbRecord, ...data[type][i] };
											const savedRecord = await executeUpdateTransaction(pool, array, data[type][i]._id, updatedRecord, data);
											data[type][i] = { ...savedRecord, $storage, $database, $array };
										} else {
											data[type][i] = { ...data[type][i], ...dbRecord, $storage, $database, $array };
										}
									} else {
										data[type][i] = {
											...data[type][i],
											...dbRecord,
											$storage, $database, $array
										};
									}
								} else {
									data[type].splice(i, 1);
									i--;
								}
							}
							else if (method === "update") {
								const updatePayload = { ...data[type][i] };
								delete updatePayload._id;
								delete updatePayload.filter;

								if (data[type][i]._id) {
									const updatedDoc = await executeUpdateTransaction(pool, array, data[type][i]._id, updatePayload, data);
									if (updatedDoc) {
										data[type][i] = { ...updatedDoc, $storage, $database, $array };
									}
								} else if (isFilter) {
									const selectSql = `SELECT _id FROM "${array}" ${sqlWhere}`;
									process.emit("usage", {
										type: "egress",
										data: { selectSql, params },
										organization_id: data.organization_id
									});
									const selectResult = await pool.query(selectSql, params);
									
									for (let row of selectResult.rows) {
										const updatedDoc = await executeUpdateTransaction(pool, array, row._id, updatePayload, data);
										if (updatedDoc) {
											documents.push({ ...updatedDoc, ...reference });
										}
									}
								}
							}
							else if (method === "delete") {
								let sql, queryParams;
								if (data[type][i]._id) {
									sql = `DELETE FROM "${array}" WHERE _id = $1 AND organization_id = $2 RETURNING _id;`;
									queryParams = [data[type][i]._id, data.organization_id];
								} else if (isFilter) {
									sql = `DELETE FROM "${array}" ${sqlWhere} RETURNING _id;`;
									queryParams = params;
								}

								if (sql) {
									process.emit("usage", {
										type: "egress",
										data: { sql, queryParams },
										organization_id: data.organization_id
									});
									const result = await pool.query(sql, queryParams);
									
									process.emit("usage", {
										type: "ingress",
										data: result.rows,
										organization_id: data.organization_id
									});

									for (let row of result.rows) {
										if (isFilter) {
											documents.push({ _id: row._id, ...reference });
										} else {
											data[type][i] = { _id: row._id, $storage, $database, $array };
										}
									}
								}
							}
						}
					}
				}

				data = createData(data, documents, type);
				resolve(data);
			} catch (error) {
				errorHandler(data, error);
				console.log(method, "error", error);
				resolve(data);
			}
		}
	);
}

export default object