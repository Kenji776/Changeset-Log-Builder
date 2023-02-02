PageReference pr=new PageReference('/changemgmt/listOutboundChangeSet.apexp');
Blob output=pr.getContent();
System.debug(output.toString());