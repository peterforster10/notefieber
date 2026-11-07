select * from tenants order by id;

select * from workspaces where tenant_id = '01a1b13e-1f6b-743b-be2b-0cf6aa924318' order by id;

select * from spaces where workspace_id = '01a1b13e-1f6b-749e-aacc-669645e22c2f' order by id;

select * from pages where space_id = '01a1b13e-1f78-7a45-ba25-3fdf9663fed2';

select * from page_contents where page_id = '01a1b13e-1f86-75de-83f3-1a7fe7b224b3';

select * from page_versions where page_id = '01a1b13e-1f86-75de-83f3-1a7fe7b224b3';

select * from page_links;

select * from page_search where page_id = '01a1b13e-1f78-7a75-a15a-1af4df3d80de';


select * from users order by id;

select * from workspace_members where workspace_id = '01a1b13e-1f6b-749e-aacc-669645e22c2f';

select * from groups order by id;

select * from group_members where group_id = '01a1b13e-1f76-74f9-8177-8874a7316a10';