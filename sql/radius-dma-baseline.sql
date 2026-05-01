-- phpMyAdmin SQL Dump
-- version 2.11.0
-- http://www.phpmyadmin.net
--
-- Host: localhost
-- Generation Time: Aug 19, 2019 at 11:47 AM
-- Server version: 5.1.73
-- PHP Version: 5.3.3

SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";

--
-- Database: `radius`
--

-- --------------------------------------------------------

--
-- Table structure for table `nas`
--

DROP TABLE IF EXISTS `nas`;
CREATE TABLE `nas` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `nasname` varchar(128) NOT NULL,
  `shortname` varchar(32) DEFAULT NULL,
  `type` varchar(30) DEFAULT 'other',
  `ports` int(5) DEFAULT NULL,
  `secret` varchar(60) NOT NULL DEFAULT 'secret',
  `community` varchar(50) DEFAULT NULL,
  `description` varchar(200) DEFAULT 'RADIUS Client',
  `starospassword` varchar(32) NOT NULL,
  `ciscobwmode` tinyint(1) NOT NULL,
  `apiusername` varchar(32) NOT NULL,
  `apipassword` varchar(32) NOT NULL,
  `apiver` int(1) NOT NULL,
  `coamode` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nasname` (`nasname`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8;

--
-- Dumping data for table `nas`
--

INSERT INTO `nas` (`id`, `nasname`, `shortname`, `type`, `ports`, `secret`, `community`, `description`, `starospassword`, `ciscobwmode`, `apiusername`, `apipassword`, `apiver`, `coamode`) VALUES
(6, '192.168.0.8', 'Mikrotik', '0', NULL, 'testing123', NULL, '', '', 0, '', '', 0, 0),
(27, '127.0.0.1', 'Localhost', '0', NULL, 'testing123', NULL, '', '', 0, '', '', 0, 0),
(29, '192.168.0.3', 'Linux', '0', NULL, 'testing123', NULL, '', '', 0, '', '', 0, 0);

-- --------------------------------------------------------

--
-- Table structure for table `radacct`
--

DROP TABLE IF EXISTS `radacct`;
CREATE TABLE `radacct` (
  `radacctid` bigint(21) NOT NULL AUTO_INCREMENT,
  `acctsessionid` varchar(64) NOT NULL DEFAULT '',
  `acctuniqueid` varchar(32) NOT NULL DEFAULT '',
  `username` varchar(64) NOT NULL DEFAULT '',
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `realm` varchar(64) DEFAULT '',
  `nasipaddress` varchar(15) NOT NULL DEFAULT '',
  `nasportid` varchar(15) DEFAULT NULL,
  `nasporttype` varchar(32) DEFAULT NULL,
  `acctstarttime` datetime DEFAULT NULL,
  `acctstoptime` datetime DEFAULT NULL,
  `acctsessiontime` int(12) DEFAULT NULL,
  `acctauthentic` varchar(32) DEFAULT NULL,
  `connectinfo_start` varchar(50) DEFAULT NULL,
  `connectinfo_stop` varchar(50) DEFAULT NULL,
  `acctinputoctets` bigint(20) DEFAULT NULL,
  `acctoutputoctets` bigint(20) DEFAULT NULL,
  `calledstationid` varchar(50) NOT NULL DEFAULT '',
  `callingstationid` varchar(50) NOT NULL DEFAULT '',
  `acctterminatecause` varchar(32) NOT NULL DEFAULT '',
  `servicetype` varchar(32) DEFAULT NULL,
  `framedprotocol` varchar(32) DEFAULT NULL,
  `framedipaddress` varchar(15) NOT NULL DEFAULT '',
  `acctstartdelay` int(12) DEFAULT NULL,
  `acctstopdelay` int(12) DEFAULT NULL,
  `xascendsessionsvrkey` varchar(10) DEFAULT NULL,
  `_accttime` datetime DEFAULT NULL,
  `_srvid` int(11) DEFAULT NULL,
  `_dailynextsrvactive` tinyint(1) DEFAULT NULL,
  `_apid` int(11) DEFAULT NULL,
  PRIMARY KEY (`radacctid`),
  KEY `username` (`username`),
  KEY `framedipaddress` (`framedipaddress`),
  KEY `acctsessionid` (`acctsessionid`),
  KEY `acctsessiontime` (`acctsessiontime`),
  KEY `acctuniqueid` (`acctuniqueid`),
  KEY `acctstarttime` (`acctstarttime`),
  KEY `acctstoptime` (`acctstoptime`),
  KEY `nasipaddress` (`nasipaddress`),
  KEY `_AcctTime` (`_accttime`),
  KEY `callingstationid` (`callingstationid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radacct`
--


-- --------------------------------------------------------

--
-- Table structure for table `radcheck`
--

DROP TABLE IF EXISTS `radcheck`;
CREATE TABLE `radcheck` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '==',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `username` (`username`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radcheck`
--

INSERT INTO `radcheck` (`id`, `username`, `attribute`, `op`, `value`) VALUES
(4274, 'user', 'Cleartext-Password', ':=', '1111'),
(4275, 'user', 'Simultaneous-Use', ':=', '10');

-- --------------------------------------------------------

--
-- Table structure for table `radgroupcheck`
--

DROP TABLE IF EXISTS `radgroupcheck`;
CREATE TABLE `radgroupcheck` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '==',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `groupname` (`groupname`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radgroupcheck`
--


-- --------------------------------------------------------

--
-- Table structure for table `radgroupreply`
--

DROP TABLE IF EXISTS `radgroupreply`;
CREATE TABLE `radgroupreply` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '=',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `groupname` (`groupname`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radgroupreply`
--


-- --------------------------------------------------------

--
-- Table structure for table `radippool`
--

DROP TABLE IF EXISTS `radippool`;
CREATE TABLE `radippool` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `pool_name` varchar(30) NOT NULL,
  `framedipaddress` varchar(15) NOT NULL,
  `nasipaddress` varchar(15) NOT NULL,
  `calledstationid` varchar(30) NOT NULL,
  `callingstationid` varchar(30) NOT NULL,
  `expiry_time` datetime DEFAULT NULL,
  `username` varchar(64) NOT NULL,
  `pool_key` varchar(30) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radippool`
--


-- --------------------------------------------------------

--
-- Table structure for table `radpostauth`
--

DROP TABLE IF EXISTS `radpostauth`;
CREATE TABLE `radpostauth` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `pass` varchar(64) NOT NULL DEFAULT '',
  `reply` varchar(32) NOT NULL DEFAULT '',
  `authdate` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `nasipaddress` varchar(15) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `username` (`username`),
  KEY `authdate` (`authdate`),
  KEY `nasipaddress` (`nasipaddress`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radpostauth`
--


-- --------------------------------------------------------

--
-- Table structure for table `radreply`
--

DROP TABLE IF EXISTS `radreply`;
CREATE TABLE `radreply` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '=',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radreply`
--


-- --------------------------------------------------------

--
-- Table structure for table `radusergroup`
--

DROP TABLE IF EXISTS `radusergroup`;
CREATE TABLE `radusergroup` (
  `username` varchar(64) NOT NULL DEFAULT '',
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `priority` int(11) NOT NULL DEFAULT '1',
  KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `radusergroup`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_actsrv`
--

DROP TABLE IF EXISTS `rm_actsrv`;
CREATE TABLE `rm_actsrv` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `datetime` datetime NOT NULL,
  `username` varchar(64) NOT NULL,
  `srvid` int(11) NOT NULL,
  `dailynextsrvactive` tinyint(1) NOT NULL,
  UNIQUE KEY `id` (`id`),
  KEY `datetime` (`datetime`),
  KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_actsrv`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_allowedmanagers`
--

DROP TABLE IF EXISTS `rm_allowedmanagers`;
CREATE TABLE `rm_allowedmanagers` (
  `srvid` int(11) NOT NULL,
  `managername` varchar(64) NOT NULL,
  KEY `srvid` (`srvid`),
  KEY `managername` (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_allowedmanagers`
--

INSERT INTO `rm_allowedmanagers` (`srvid`, `managername`) VALUES
(9, 'manager1'),
(9, 'admin'),
(12, 'admin'),
(12, 'manager1'),
(13, 'manager1'),
(13, 'admin'),
(15, 'manager1'),
(15, 'admin'),
(22, 'manager1'),
(22, 'admin'),
(25, 'manager1'),
(25, 'admin'),
(1, 'admin'),
(1, 'manager1'),
(7, 'admin'),
(7, 'manager1'),
(8, 'admin'),
(8, 'manager1'),
(10, 'admin'),
(10, 'manager1'),
(14, 'admin'),
(14, 'manager1'),
(2, 'admin'),
(2, 'manager1'),
(23, 'admin'),
(23, 'manager1'),
(4, 'admin'),
(4, 'manager1'),
(11, 'admin'),
(11, 'manager1'),
(32, 'admin'),
(32, 'manager1'),
(21, 'admin'),
(21, 'manager1'),
(18, 'admin'),
(18, 'manager1'),
(20, 'admin'),
(20, 'manager1'),
(29, 'admin'),
(29, 'manager1'),
(17, 'admin'),
(17, 'manager1'),
(5, 'admin'),
(5, 'manager1'),
(31, 'admin'),
(31, 'manager1'),
(28, 'admin'),
(28, 'manager1'),
(0, 'admin'),
(0, 'manager1'),
(3, 'admin'),
(3, 'manager1'),
(19, 'admin'),
(19, 'manager1'),
(30, 'admin'),
(30, 'manager1'),
(16, 'admin'),
(16, 'manager1');

-- --------------------------------------------------------

--
-- Table structure for table `rm_allowednases`
--

DROP TABLE IF EXISTS `rm_allowednases`;
CREATE TABLE `rm_allowednases` (
  `srvid` int(11) NOT NULL,
  `nasid` int(11) NOT NULL,
  KEY `srvid` (`srvid`),
  KEY `nasid` (`nasid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_allowednases`
--

INSERT INTO `rm_allowednases` (`srvid`, `nasid`) VALUES
(25, 6),
(22, 6),
(9, 6),
(15, 6),
(12, 6),
(13, 6),
(13, 27),
(12, 27),
(15, 27),
(9, 27),
(22, 27),
(25, 27),
(1, 27),
(1, 6),
(1, 29),
(9, 29),
(12, 29),
(13, 29),
(15, 29),
(22, 29),
(25, 29),
(7, 29),
(7, 27),
(7, 6),
(8, 29),
(8, 27),
(8, 6),
(10, 29),
(10, 27),
(10, 6),
(14, 29),
(14, 27),
(14, 6),
(2, 29),
(2, 27),
(2, 6),
(23, 29),
(23, 27),
(23, 6),
(4, 29),
(4, 27),
(4, 6),
(11, 29),
(11, 27),
(11, 6),
(32, 29),
(32, 27),
(32, 6),
(21, 29),
(21, 27),
(21, 6),
(18, 29),
(18, 27),
(18, 6),
(20, 29),
(20, 27),
(20, 6),
(29, 29),
(29, 27),
(29, 6),
(1, 30),
(2, 30),
(4, 30),
(7, 30),
(8, 30),
(9, 30),
(10, 30),
(11, 30),
(12, 30),
(13, 30),
(14, 30),
(15, 30),
(18, 30),
(20, 30),
(21, 30),
(22, 30),
(23, 30),
(25, 30),
(29, 30),
(32, 30),
(17, 30),
(17, 29),
(17, 27),
(17, 6),
(5, 30),
(5, 29),
(5, 27),
(5, 6),
(31, 30),
(31, 29),
(31, 27),
(31, 6),
(1, 31),
(2, 31),
(4, 31),
(5, 31),
(7, 31),
(8, 31),
(9, 31),
(10, 31),
(11, 31),
(12, 31),
(13, 31),
(14, 31),
(15, 31),
(17, 31),
(18, 31),
(20, 31),
(21, 31),
(22, 31),
(23, 31),
(25, 31),
(29, 31),
(31, 31),
(32, 31),
(28, 30),
(28, 29),
(28, 27),
(28, 6),
(28, 31),
(0, 30),
(0, 29),
(0, 27),
(0, 6),
(0, 31),
(3, 30),
(3, 29),
(3, 27),
(3, 6),
(3, 31),
(19, 29),
(19, 27),
(19, 6),
(30, 29),
(30, 27),
(30, 6),
(16, 29),
(16, 27),
(16, 6);

-- --------------------------------------------------------

--
-- Table structure for table `rm_ap`
--

DROP TABLE IF EXISTS `rm_ap`;
CREATE TABLE `rm_ap` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  `enable` tinyint(1) NOT NULL,
  `accessmode` tinyint(1) NOT NULL,
  `ip` varchar(15) NOT NULL,
  `community` varchar(32) NOT NULL,
  `apiusername` varchar(32) NOT NULL,
  `apipassword` varchar(32) NOT NULL,
  `description` varchar(200) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_ap`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_cards`
--

DROP TABLE IF EXISTS `rm_cards`;
CREATE TABLE `rm_cards` (
  `id` bigint(20) NOT NULL,
  `cardnum` varchar(16) NOT NULL,
  `password` varchar(8) NOT NULL,
  `value` decimal(22,2) NOT NULL,
  `expiration` date NOT NULL,
  `series` varchar(16) NOT NULL,
  `date` date NOT NULL,
  `owner` varchar(64) NOT NULL,
  `used` datetime NOT NULL,
  `cardtype` tinyint(1) NOT NULL,
  `revoked` tinyint(1) NOT NULL,
  `downlimit` bigint(20) NOT NULL,
  `uplimit` bigint(20) NOT NULL,
  `comblimit` bigint(20) NOT NULL,
  `uptimelimit` bigint(20) NOT NULL,
  `srvid` int(11) NOT NULL,
  `transid` varchar(32) NOT NULL,
  `active` tinyint(1) NOT NULL,
  `expiretime` bigint(20) NOT NULL,
  `timebaseexp` tinyint(1) NOT NULL,
  `timebaseonline` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cardnum` (`cardnum`),
  KEY `series` (`series`),
  KEY `used` (`used`),
  KEY `owner` (`owner`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_cards`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_changesrv`
--

DROP TABLE IF EXISTS `rm_changesrv`;
CREATE TABLE `rm_changesrv` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `newsrvid` int(11) NOT NULL,
  `newsrvname` varchar(50) NOT NULL,
  `scheduledate` date NOT NULL,
  `requestdate` date NOT NULL,
  `status` tinyint(1) NOT NULL,
  `transid` varchar(32) NOT NULL,
  `requested` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `requestdate` (`requestdate`),
  KEY `scheduledate` (`scheduledate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_changesrv`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_cmts`
--

DROP TABLE IF EXISTS `rm_cmts`;
CREATE TABLE `rm_cmts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip` varchar(15) NOT NULL,
  `name` varchar(32) NOT NULL,
  `community` varchar(32) NOT NULL,
  `descr` varchar(200) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_cmts`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_colsetlistdocsis`
--

DROP TABLE IF EXISTS `rm_colsetlistdocsis`;
CREATE TABLE `rm_colsetlistdocsis` (
  `managername` varchar(64) NOT NULL,
  `colname` varchar(32) NOT NULL,
  KEY `managername` (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_colsetlistdocsis`
--

INSERT INTO `rm_colsetlistdocsis` (`managername`, `colname`) VALUES
('admin', 'comment'),
('admin', 'email'),
('admin', 'state'),
('admin', 'country'),
('admin', 'zip'),
('admin', 'city'),
('admin', 'address'),
('admin', 'company'),
('admin', 'lastname'),
('admin', 'firstname'),
('admin', 'groupname'),
('admin', 'upstreamname'),
('admin', 'cmtsname'),
('admin', 'pingtime'),
('admin', 'rxpwr'),
('admin', 'txpwr'),
('admin', 'snrus'),
('admin', 'snrds'),
('admin', 'username'),
('admin', 'cmmac'),
('admin', 'cmip'),
('admin', 'cpeip'),
('manager1', 'username'),
('manager1', 'cmmac'),
('manager1', 'cmip'),
('manager1', 'cpeip'),
('manager1', 'snrds'),
('manager1', 'snrus'),
('manager1', 'txpwr'),
('manager1', 'rxpwr'),
('manager1', 'pingtime'),
('manager1', 'cmtsname'),
('manager1', 'upstreamname'),
('manager1', 'groupname'),
('manager1', 'firstname'),
('manager1', 'lastname'),
('manager1', 'company'),
('manager1', 'address'),
('manager1', 'city'),
('manager1', 'zip'),
('manager1', 'country'),
('manager1', 'state'),
('manager1', 'email'),
('manager1', 'comment');

-- --------------------------------------------------------

--
-- Table structure for table `rm_colsetlistradius`
--

DROP TABLE IF EXISTS `rm_colsetlistradius`;
CREATE TABLE `rm_colsetlistradius` (
  `managername` varchar(64) NOT NULL,
  `colname` varchar(32) NOT NULL,
  KEY `managername` (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_colsetlistradius`
--

INSERT INTO `rm_colsetlistradius` (`managername`, `colname`) VALUES
('admin', 'comment'),
('admin', 'email'),
('admin', 'state'),
('admin', 'country'),
('admin', 'zip'),
('admin', 'city'),
('admin', 'address'),
('admin', 'company'),
('admin', 'lastname'),
('admin', 'firstname'),
('admin', 'group'),
('admin', 'nas'),
('admin', 'ccq'),
('admin', 'snr'),
('admin', 'signal'),
('admin', 'apname'),
('admin', 'mac'),
('admin', 'ip'),
('admin', 'upload'),
('admin', 'download'),
('admin', 'onlinetime'),
('admin', 'starttime'),
('admin', 'username'),
('manager1', 'username'),
('manager1', 'starttime'),
('manager1', 'onlinetime'),
('manager1', 'download'),
('manager1', 'upload'),
('manager1', 'ip'),
('manager1', 'mac'),
('manager1', 'apname'),
('manager1', 'signal'),
('manager1', 'snr'),
('manager1', 'ccq'),
('manager1', 'nas'),
('manager1', 'group'),
('manager1', 'firstname'),
('manager1', 'lastname'),
('manager1', 'company'),
('manager1', 'address'),
('manager1', 'city'),
('manager1', 'zip'),
('manager1', 'country'),
('manager1', 'state'),
('manager1', 'email'),
('manager1', 'comment');

-- --------------------------------------------------------

--
-- Table structure for table `rm_colsetlistusers`
--

DROP TABLE IF EXISTS `rm_colsetlistusers`;
CREATE TABLE `rm_colsetlistusers` (
  `managername` varchar(64) NOT NULL,
  `colname` varchar(32) NOT NULL,
  KEY `managername` (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_colsetlistusers`
--

INSERT INTO `rm_colsetlistusers` (`managername`, `colname`) VALUES
('admin', 'username'),
('admin', 'srvname'),
('admin', 'expiry'),
('admin', 'availdl'),
('admin', 'availul'),
('admin', 'availtotal'),
('admin', 'availtime'),
('admin', 'cpeip'),
('admin', 'cmip'),
('admin', 'cmmac'),
('admin', 'firstname'),
('admin', 'lastname'),
('admin', 'company'),
('admin', 'address'),
('admin', 'city'),
('admin', 'zip'),
('admin', 'country'),
('admin', 'state'),
('admin', 'email'),
('admin', 'registered'),
('admin', 'lastlogoff'),
('admin', 'comment'),
('manager1', 'username'),
('manager1', 'srvname'),
('manager1', 'expiry'),
('manager1', 'availdl'),
('manager1', 'availul'),
('manager1', 'availtotal'),
('manager1', 'availtime'),
('manager1', 'cpeip'),
('manager1', 'cmip'),
('manager1', 'cmmac'),
('manager1', 'firstname'),
('manager1', 'lastname'),
('manager1', 'company'),
('manager1', 'address'),
('manager1', 'city'),
('manager1', 'zip'),
('manager1', 'country'),
('manager1', 'state'),
('manager1', 'email'),
('manager1', 'registered'),
('manager1', 'lastlogoff'),
('manager1', 'comment');

-- --------------------------------------------------------

--
-- Table structure for table `rm_dailyacct`
--

DROP TABLE IF EXISTS `rm_dailyacct`;
CREATE TABLE `rm_dailyacct` (
  `radacctid` bigint(21) NOT NULL,
  `acctuniqueid` varchar(32) NOT NULL,
  `username` varchar(64) NOT NULL,
  `acctstarttime` datetime NOT NULL,
  `acctstoptime` datetime NOT NULL,
  `acctsessiontime` int(12) NOT NULL,
  `dlbytesstart` bigint(20) NOT NULL,
  `dlbytesstop` bigint(20) NOT NULL,
  `dlbytes` bigint(20) NOT NULL,
  `ulbytesstart` bigint(20) NOT NULL,
  `ulbytesstop` bigint(20) NOT NULL,
  `ulbytes` bigint(20) NOT NULL,
  KEY `radacctid` (`radacctid`),
  KEY `acctuniqueid` (`acctuniqueid`),
  KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_dailyacct`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_ias`
--

DROP TABLE IF EXISTS `rm_ias`;
CREATE TABLE `rm_ias` (
  `iasid` int(11) NOT NULL AUTO_INCREMENT,
  `iasname` varchar(50) NOT NULL,
  `price` decimal(20,2) NOT NULL,
  `downlimit` bigint(20) NOT NULL,
  `uplimit` bigint(20) NOT NULL,
  `comblimit` bigint(20) NOT NULL,
  `uptimelimit` bigint(20) NOT NULL,
  `expiretime` bigint(20) NOT NULL,
  `timebaseonline` tinyint(1) NOT NULL,
  `timebaseexp` tinyint(1) NOT NULL,
  `srvid` int(11) NOT NULL,
  `enableias` tinyint(1) NOT NULL,
  `expiremode` tinyint(1) NOT NULL,
  `expiration` date NOT NULL,
  `simuse` int(11) NOT NULL,
  PRIMARY KEY (`iasid`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_ias`
--

INSERT INTO `rm_ias` (`iasid`, `iasname`, `price`, `downlimit`, `uplimit`, `comblimit`, `uptimelimit`, `expiretime`, `timebaseonline`, `timebaseexp`, `srvid`, `enableias`, `expiremode`, `expiration`, `simuse`) VALUES
(2, '500 MB', '10.00', 500, 0, 0, 0, 0, 0, 0, 15, 1, 0, '2020-12-31', 1),
(3, '10 hours online time', '5.00', 0, 0, 0, 10, 0, 1, 0, 14, 1, 0, '2010-12-31', 1),
(4, '2 days', '5.00', 0, 0, 0, 0, 2, 0, 2, 13, 1, 1, '0000-00-00', 1),
(10, '15 minutes online time', '1.00', 0, 0, 0, 15, 0, 0, 0, 14, 1, 0, '2020-12-31', 1);

-- --------------------------------------------------------

--
-- Table structure for table `rm_invoices`
--

DROP TABLE IF EXISTS `rm_invoices`;
CREATE TABLE `rm_invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invgroup` tinyint(1) NOT NULL,
  `invnum` varchar(16) NOT NULL,
  `managername` varchar(64) NOT NULL,
  `username` varchar(64) NOT NULL,
  `date` date NOT NULL,
  `bytesdl` bigint(20) NOT NULL,
  `bytesul` bigint(20) NOT NULL,
  `bytescomb` bigint(20) NOT NULL,
  `downlimit` bigint(20) NOT NULL,
  `uplimit` bigint(20) NOT NULL,
  `comblimit` bigint(20) NOT NULL,
  `time` int(11) NOT NULL,
  `uptimelimit` bigint(20) NOT NULL,
  `days` int(6) NOT NULL,
  `expiration` date NOT NULL,
  `capdl` tinyint(1) NOT NULL,
  `capul` tinyint(1) NOT NULL,
  `captotal` tinyint(1) NOT NULL,
  `captime` tinyint(1) NOT NULL,
  `capdate` tinyint(1) NOT NULL,
  `service` varchar(60) NOT NULL,
  `comment` varchar(200) NOT NULL,
  `transid` varchar(32) NOT NULL,
  `amount` decimal(13,2) NOT NULL,
  `address` varchar(50) NOT NULL,
  `city` varchar(50) NOT NULL,
  `zip` varchar(8) NOT NULL,
  `country` varchar(50) NOT NULL,
  `state` varchar(50) NOT NULL,
  `fullname` varchar(100) NOT NULL,
  `taxid` varchar(40) NOT NULL,
  `paymentopt` date NOT NULL,
  `invtype` tinyint(1) NOT NULL,
  `paymode` tinyint(4) NOT NULL,
  `paid` date NOT NULL,
  `price` decimal(25,6) NOT NULL,
  `tax` decimal(25,6) NOT NULL,
  `advtax` decimal(25,6) NOT NULL,
  `vatpercent` decimal(4,2) NOT NULL,
  `advtaxpercent` decimal(4,2) NOT NULL,
  `remark` varchar(400) NOT NULL,
  `balance` decimal(20,2) NOT NULL,
  `gwtransid` varchar(255) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `invnum` (`invnum`),
  KEY `username` (`username`),
  KEY `managername` (`managername`),
  KEY `date` (`date`),
  KEY `gwtransid` (`gwtransid`),
  KEY `comment` (`comment`),
  KEY `paymode` (`paymode`),
  KEY `invgroup` (`invgroup`),
  KEY `paid` (`paid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_invoices`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_ippools`
--

DROP TABLE IF EXISTS `rm_ippools`;
CREATE TABLE `rm_ippools` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` tinyint(1) NOT NULL,
  `name` varchar(32) NOT NULL,
  `fromip` varchar(15) NOT NULL,
  `toip` varchar(15) NOT NULL,
  `descr` varchar(200) NOT NULL,
  `nextpoolid` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `name` (`name`),
  KEY `nextid` (`nextpoolid`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_ippools`
--

INSERT INTO `rm_ippools` (`id`, `type`, `name`, `fromip`, `toip`, `descr`, `nextpoolid`) VALUES
(19, 0, 'DOCSIS CM', '10.0.0.2', '10.0.0.254', '', -1),
(22, 0, 'DOCSIS CPE', '10.15.0.2', '10.15.0.254', '', -1);

-- --------------------------------------------------------

--
-- Table structure for table `rm_managers`
--

DROP TABLE IF EXISTS `rm_managers`;
CREATE TABLE `rm_managers` (
  `managername` varchar(64) NOT NULL,
  `password` varchar(32) NOT NULL,
  `firstname` varchar(50) NOT NULL,
  `lastname` varchar(50) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `address` varchar(50) NOT NULL,
  `city` varchar(50) NOT NULL,
  `zip` varchar(8) NOT NULL,
  `country` varchar(50) NOT NULL,
  `state` varchar(50) NOT NULL,
  `comment` varchar(200) NOT NULL,
  `company` varchar(50) NOT NULL,
  `vatid` varchar(40) NOT NULL,
  `email` varchar(50) NOT NULL,
  `balance` decimal(20,2) NOT NULL,
  `perm_listusers` tinyint(1) NOT NULL,
  `perm_createusers` tinyint(1) NOT NULL,
  `perm_editusers` tinyint(1) NOT NULL,
  `perm_edituserspriv` tinyint(1) NOT NULL,
  `perm_deleteusers` tinyint(1) NOT NULL,
  `perm_listmanagers` tinyint(1) NOT NULL,
  `perm_createmanagers` tinyint(1) NOT NULL,
  `perm_editmanagers` tinyint(1) NOT NULL,
  `perm_deletemanagers` tinyint(1) NOT NULL,
  `perm_listservices` tinyint(1) NOT NULL,
  `perm_createservices` tinyint(1) NOT NULL,
  `perm_editservices` tinyint(1) NOT NULL,
  `perm_deleteservices` tinyint(1) NOT NULL,
  `perm_listonlineusers` tinyint(1) NOT NULL,
  `perm_listinvoices` tinyint(1) NOT NULL,
  `perm_trafficreport` tinyint(1) NOT NULL,
  `perm_addcredits` tinyint(1) NOT NULL,
  `perm_negbalance` tinyint(1) NOT NULL,
  `perm_listallinvoices` tinyint(1) NOT NULL,
  `perm_showinvtotals` tinyint(1) NOT NULL,
  `perm_logout` tinyint(1) NOT NULL,
  `perm_cardsys` tinyint(1) NOT NULL,
  `perm_editinvoice` tinyint(1) NOT NULL,
  `perm_allusers` tinyint(1) NOT NULL,
  `perm_allowdiscount` tinyint(1) NOT NULL,
  `perm_enwriteoff` tinyint(1) NOT NULL,
  `perm_accessap` tinyint(1) NOT NULL,
  `perm_cts` tinyint(1) NOT NULL,
  `perm_email` tinyint(1) NOT NULL,
  `perm_sms` tinyint(1) NOT NULL,
  `enablemanager` tinyint(1) NOT NULL,
  `lang` varchar(30) NOT NULL,
  PRIMARY KEY (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_managers`
--

INSERT INTO `rm_managers` (`managername`, `password`, `firstname`, `lastname`, `phone`, `mobile`, `address`, `city`, `zip`, `country`, `state`, `comment`, `company`, `vatid`, `email`, `balance`, `perm_listusers`, `perm_createusers`, `perm_editusers`, `perm_edituserspriv`, `perm_deleteusers`, `perm_listmanagers`, `perm_createmanagers`, `perm_editmanagers`, `perm_deletemanagers`, `perm_listservices`, `perm_createservices`, `perm_editservices`, `perm_deleteservices`, `perm_listonlineusers`, `perm_listinvoices`, `perm_trafficreport`, `perm_addcredits`, `perm_negbalance`, `perm_listallinvoices`, `perm_showinvtotals`, `perm_logout`, `perm_cardsys`, `perm_editinvoice`, `perm_allusers`, `perm_allowdiscount`, `perm_enwriteoff`, `perm_accessap`, `perm_cts`, `perm_email`, `perm_sms`, `enablemanager`, `lang`) VALUES
('root', 'd321ff85b62fbf3ae282ba02011d0e19', 'Root', 'Admin', '', '', '', '', '', '', '', 'Future Radius bootstrap', '', '', '', '0.00', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'English'),
('manager1', 'b59c67bf196a4758191e42f76670ceba', 'John', 'Smith', '546-5122-5412', '594-441-4121', 'St. Anders Blvd 1654.', 'Smallville', '532321', '', 'Colorado', 'Reseller', 'My Wireless Inc.', '145121', 'john@mywirelessinc.com', '739.16', 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 'English');

-- --------------------------------------------------------

--
-- Table structure for table `rm_newusers`
--

DROP TABLE IF EXISTS `rm_newusers`;
CREATE TABLE `rm_newusers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `firstname` varchar(50) NOT NULL,
  `lastname` varchar(50) NOT NULL,
  `address` varchar(100) NOT NULL,
  `city` varchar(50) NOT NULL,
  `zip` varchar(8) NOT NULL,
  `country` varchar(50) NOT NULL,
  `state` varchar(50) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `email` varchar(100) NOT NULL,
  `vatid` varchar(40) NOT NULL,
  `srvid` int(11) NOT NULL,
  `actcode` varchar(10) NOT NULL,
  `actcount` int(11) NOT NULL,
  `lang` varchar(30) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_newusers`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_onlinecm`
--

DROP TABLE IF EXISTS `rm_onlinecm`;
CREATE TABLE `rm_onlinecm` (
  `username` varchar(64) NOT NULL DEFAULT '',
  `maccm` varchar(17) DEFAULT NULL,
  `enableuser` tinyint(1) DEFAULT NULL,
  `staticipcm` varchar(15) DEFAULT NULL,
  `maccpe` varchar(17) DEFAULT NULL,
  `ipcpe` varchar(15) DEFAULT NULL,
  `ipmodecpe` tinyint(1) DEFAULT NULL,
  `cmtsid` int(11) DEFAULT NULL,
  `groupid` int(11) DEFAULT NULL,
  `groupname` varchar(50) DEFAULT NULL,
  `snrds` decimal(11,1) DEFAULT NULL,
  `snrus` decimal(11,1) DEFAULT NULL,
  `txpwr` decimal(11,1) DEFAULT NULL,
  `rxpwr` decimal(11,1) DEFAULT NULL,
  `pingtime` decimal(11,1) DEFAULT NULL,
  `upstreamname` varchar(50) DEFAULT NULL,
  `ifidx` int(11) DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`username`),
  KEY `maccm` (`maccm`),
  KEY `staticipcm` (`staticipcm`),
  KEY `ipcpe` (`ipcpe`),
  KEY `groupname` (`groupname`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_onlinecm`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_phpsess`
--

DROP TABLE IF EXISTS `rm_phpsess`;
CREATE TABLE `rm_phpsess` (
  `managername` varchar(64) NOT NULL,
  `ip` varchar(15) NOT NULL,
  `sessid` varchar(64) NOT NULL,
  `lastact` datetime NOT NULL,
  `closed` tinyint(1) DEFAULT NULL,
  KEY `managername` (`managername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_phpsess`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_radacct`
--

DROP TABLE IF EXISTS `rm_radacct`;
CREATE TABLE `rm_radacct` (
  `radacctid` bigint(21) NOT NULL,
  `acctuniqueid` varchar(32) NOT NULL,
  `username` varchar(64) NOT NULL,
  `acctstarttime` datetime NOT NULL,
  `acctstoptime` datetime NOT NULL,
  `acctsessiontime` int(12) NOT NULL,
  `acctsessiontimeratio` decimal(3,2) NOT NULL,
  `dlbytesstart` bigint(20) NOT NULL,
  `dlbytesstop` bigint(20) NOT NULL,
  `dlbytes` bigint(20) NOT NULL,
  `dlratio` decimal(3,2) NOT NULL,
  `ulbytesstart` bigint(20) NOT NULL,
  `ulbytesstop` bigint(20) NOT NULL,
  `ulbytes` bigint(20) NOT NULL,
  `ulratio` decimal(3,2) NOT NULL,
  KEY `radacctid` (`radacctid`),
  KEY `acctuniqueid` (`acctuniqueid`),
  KEY `username` (`username`),
  KEY `acctstarttime` (`acctstarttime`),
  KEY `acctstoptime` (`acctstoptime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_radacct`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_services`
--

DROP TABLE IF EXISTS `rm_services`;
CREATE TABLE `rm_services` (
  `srvid` int(11) NOT NULL,
  `srvname` varchar(50) NOT NULL,
  `descr` varchar(255) NOT NULL,
  `downrate` int(11) NOT NULL,
  `uprate` int(11) NOT NULL,
  `limitdl` tinyint(1) NOT NULL,
  `limitul` tinyint(1) NOT NULL,
  `limitcomb` tinyint(1) NOT NULL,
  `limitexpiration` tinyint(1) NOT NULL,
  `limituptime` tinyint(1) NOT NULL,
  `poolname` varchar(50) NOT NULL,
  `unitprice` decimal(25,6) NOT NULL,
  `unitpriceadd` decimal(25,6) NOT NULL,
  `timebaseexp` tinyint(1) NOT NULL,
  `timebaseonline` tinyint(1) NOT NULL,
  `timeunitexp` int(11) NOT NULL,
  `timeunitonline` int(11) NOT NULL,
  `trafficunitdl` int(11) NOT NULL,
  `trafficunitul` int(11) NOT NULL,
  `trafficunitcomb` int(11) NOT NULL,
  `inittimeexp` int(11) NOT NULL,
  `inittimeonline` int(11) NOT NULL,
  `initdl` int(11) NOT NULL,
  `initul` int(11) NOT NULL,
  `inittotal` int(11) NOT NULL,
  `srvtype` tinyint(1) NOT NULL,
  `timeaddmodeexp` tinyint(1) NOT NULL,
  `timeaddmodeonline` tinyint(1) NOT NULL,
  `trafficaddmode` tinyint(1) NOT NULL,
  `monthly` tinyint(1) NOT NULL,
  `enaddcredits` tinyint(1) NOT NULL,
  `minamount` int(20) NOT NULL,
  `minamountadd` int(20) NOT NULL,
  `resetctrdate` tinyint(1) NOT NULL,
  `resetctrneg` tinyint(1) NOT NULL,
  `pricecalcdownload` tinyint(1) NOT NULL,
  `pricecalcupload` tinyint(1) NOT NULL,
  `pricecalcuptime` tinyint(1) NOT NULL,
  `unitpricetax` decimal(25,6) NOT NULL,
  `unitpriceaddtax` decimal(25,6) NOT NULL,
  `enableburst` tinyint(1) NOT NULL,
  `dlburstlimit` int(11) NOT NULL,
  `ulburstlimit` int(11) NOT NULL,
  `dlburstthreshold` int(11) NOT NULL,
  `ulburstthreshold` int(11) NOT NULL,
  `dlbursttime` int(11) NOT NULL,
  `ulbursttime` int(11) NOT NULL,
  `enableservice` int(11) NOT NULL,
  `dlquota` bigint(20) NOT NULL,
  `ulquota` bigint(20) NOT NULL,
  `combquota` bigint(20) NOT NULL,
  `timequota` bigint(20) NOT NULL,
  `priority` smallint(6) NOT NULL,
  `nextsrvid` int(11) NOT NULL,
  `dailynextsrvid` int(11) NOT NULL,
  `disnextsrvid` int(11) NOT NULL,
  `availucp` tinyint(1) NOT NULL,
  `renew` tinyint(1) NOT NULL,
  `carryover` tinyint(1) NOT NULL,
  `policymapdl` varchar(50) NOT NULL,
  `policymapul` varchar(50) NOT NULL,
  `custattr` varchar(10240) NOT NULL,
  `gentftp` tinyint(1) NOT NULL,
  `cmcfg` varchar(10240) NOT NULL,
  `advcmcfg` tinyint(1) NOT NULL,
  `addamount` int(11) NOT NULL,
  `ignstatip` tinyint(1) NOT NULL,
  PRIMARY KEY (`srvid`),
  KEY `srvname` (`srvname`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_services`
--

INSERT INTO `rm_services` (`srvid`, `srvname`, `descr`, `downrate`, `uprate`, `limitdl`, `limitul`, `limitcomb`, `limitexpiration`, `limituptime`, `poolname`, `unitprice`, `unitpriceadd`, `timebaseexp`, `timebaseonline`, `timeunitexp`, `timeunitonline`, `trafficunitdl`, `trafficunitul`, `trafficunitcomb`, `inittimeexp`, `inittimeonline`, `initdl`, `initul`, `inittotal`, `srvtype`, `timeaddmodeexp`, `timeaddmodeonline`, `trafficaddmode`, `monthly`, `enaddcredits`, `minamount`, `minamountadd`, `resetctrdate`, `resetctrneg`, `pricecalcdownload`, `pricecalcupload`, `pricecalcuptime`, `unitpricetax`, `unitpriceaddtax`, `enableburst`, `dlburstlimit`, `ulburstlimit`, `dlburstthreshold`, `ulburstthreshold`, `dlbursttime`, `ulbursttime`, `enableservice`, `dlquota`, `ulquota`, `combquota`, `timequota`, `priority`, `nextsrvid`, `dailynextsrvid`, `disnextsrvid`, `availucp`, `renew`, `carryover`, `policymapdl`, `policymapul`, `custattr`, `gentftp`, `cmcfg`, `advcmcfg`, `addamount`, `ignstatip`) VALUES
(0, 'Default service', '', 8388608, 4194304, 0, 0, 0, 0, 0, '', '1.000000', '0.000000', 2, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.190000', '0.000000', 0, 1048576, 1048576, 1048576, 1048576, 10, 10, 1, 0, 0, 0, 0, 4, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 1),
(1, 'Access list - Mikrotik', '', 0, 0, 0, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(2, 'Card download limit 128 k', '500 MB download traffic', 131072, 131072, 1, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '0', 0, 1, 1),
(3, 'Postpaid MB download', '', 524288, 131072, 0, 0, 0, 0, 0, '', '0.084034', '0.000000', 2, 1, 0, 1, 1, 0, 0, 0, 1, 50, 0, 0, 2, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, '0.015966', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 1, 0, '', '', '', 0, '', 0, 1, 0),
(4, 'Prepaid total MB', '', 393216, 131072, 0, 0, 1, 0, 0, '', '1.000000', '0.000000', 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, '0.190000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3, -1, -1, -1, 1, 0, 0, '', '', '', 0, '', 0, 1, 0),
(5, 'Prepaid monthly 1 GB download', '', 262144, 131072, 1, 0, 0, 1, 0, '', '29.411765', '4.201681', 3, 1, 1, 0, 1024, 0, 0, 1, 0, 1024, 0, 0, 0, 2, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, '5.588235', '0.798319', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 1, 1, 0, '', '', '', 0, '', 0, 1, 0),
(7, 'Prepaid monthly flat + quotas', '', 1048576, 786432, 0, 0, 0, 1, 0, '', '40.000000', '0.000000', 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '7.600000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 104857600, 0, 0, 7200, 8, -1, -1, -1, 1, 0, 0, '', '', '', 0, '', 0, 1, 0),
(8, 'Postpaid online time', '', 1048576, 786432, 0, 0, 0, 0, 0, '', '0.991597', '0.000000', 2, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, '0.188403', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(9, 'Postpaid monthly flat', '', 1048576, 786432, 0, 0, 0, 0, 0, '', '20.000000', '0.000000', 3, 0, 1, 1, 0, 0, 0, 1, 4, 1, 2, 3, 2, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '3.800000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 1, 0, '', '', '', 0, '', 0, 1, 0),
(10, 'Postpaid monthly flat + quotas', '', 1048576, 786432, 0, 0, 0, 0, 0, '', '15.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '2.850000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 104857600, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(11, 'Expired', '', 262144, 131072, 0, 0, 0, 0, 0, 'expired', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(12, 'Access list - StarOS', '', 0, 0, 0, 0, 0, 0, 0, '', '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(13, 'IAS expiration limit', '', 1048576, 786432, 0, 0, 0, 1, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(14, 'IAS uptime limit', '', 1048576, 786432, 0, 0, 0, 0, 1, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(15, 'IAS download limit', '', 1048576, 786432, 1, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(16, 'Prepaid MB download', '', 819200000, 786432, 1, 0, 0, 0, 0, '', '0.100000', '0.300000', 2, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, '0.019000', '0.057000', 0, 3072, 4096, 3072, 4096, 5, 6, 1, 0, 0, 0, 0, 8, -1, -1, -1, 1, 1, 0, '', '', '', 0, '', 0, 1, 0),
(17, 'Prepaid expiration &amp; online time', '', 1048576, 131072, 0, 0, 0, 1, 1, '', '10.000000', '0.000000', 3, 0, 1, 30, 0, 0, 0, 1, 30, 0, 0, 0, 0, 2, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '1.900000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 1, 1, 0, '', '', '', 0, '', 0, 1, 0),
(18, 'Email', '', 0, 0, 0, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(19, 'Prepaid monthly', '', 262144, 131072, 0, 0, 0, 1, 0, '', '10.000000', '0.000000', 3, 1, 1, 0, 500, 0, 0, 1, 0, 1000, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, '1.900000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 1, 1, 0, '', '', '', 0, '', 0, 1, 0),
(20, 'Card expiration + download limit', '', 524288, 131072, 1, 0, 0, 1, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(21, 'Prepaid online time', '', 131072, 131072, 0, 0, 0, 0, 1, '', '0.100000', '0.000000', 3, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.019000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 1, 0, 0, '', '', '', 0, '', 0, 1, 0),
(22, 'Card online time limit', '', 524288, 131072, 0, 0, 0, 0, 1, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(23, 'Card expiration limit', '1 hour card', 524288, 131072, 0, 0, 0, 1, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(25, 'Postpaid monthly 1 GB + overquotas', '', 524288, 131072, 1, 0, 0, 0, 0, '', '20.168067', '0.840336', 3, 1, 1, 0, 1024, 0, 0, 1, 0, 1024, 0, 0, 2, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, '3.831933', '0.159664', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 1, 0, '', '', '', 0, '', 0, 1, 0),
(28, 'Cable postpaid 1024/768', '', 1048576, 786432, 0, 0, 0, 0, 0, '', '12.605042', '0.000000', 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '2.394958', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 1, 'Main {\r\n  NetworkAccess 1;\r\n  MaxCPE 2;\r\n\r\n  ClassOfService  {\r\n    ClassID 1;\r\n    MaxRateDown 1024000;\r\n    MaxRateUp 1024000;\r\n    PrivacyEnable 0;\r\n  }\r\n}', 0, 1, 0),
(29, 'Cable prepaid 512/256', '', 524288, 262144, 0, 0, 0, 1, 0, '', '8.403361', '0.000000', 3, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, '1.596639', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 1, 0, '', '', '', 1, '', 0, 1, 0),
(30, 'Postpaid monthly 1 GB', '', 2097152, 1048576, 0, 0, 1, 1, 0, '', '20.000000', '0.000000', 2, 1, 0, 0, 0, 0, 1024, 0, 0, 1024, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, '3.800000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 1, 0, '', '', '', 0, '', 0, 1, 0),
(31, 'Disabled', '', 262144, 131072, 0, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0),
(32, 'Exceeded quota', '', 131072, 131072, 0, 0, 0, 0, 0, '', '0.000000', '0.000000', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, '0.000000', '0.000000', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 8, -1, -1, -1, 0, 0, 0, '', '', '', 0, '', 0, 1, 0);

-- --------------------------------------------------------

--
-- Table structure for table `rm_settings`
--

DROP TABLE IF EXISTS `rm_settings`;
CREATE TABLE `rm_settings` (
  `currency` varchar(15) NOT NULL,
  `unixacc` tinyint(1) NOT NULL,
  `diskquota` tinyint(1) NOT NULL,
  `quotatpl` varchar(30) NOT NULL,
  `paymentopt` int(11) NOT NULL,
  `changesrv` tinyint(1) NOT NULL,
  `vatpercent` decimal(4,2) NOT NULL,
  `advtaxpercent` decimal(4,2) NOT NULL,
  `disablenotpaid` tinyint(1) NOT NULL,
  `disableexpcont` tinyint(1) NOT NULL,
  `resetctr` tinyint(1) NOT NULL,
  `newnasallsrv` tinyint(1) NOT NULL,
  `newmanallsrv` tinyint(1) NOT NULL,
  `disconnmethod` tinyint(1) NOT NULL,
  `warndl` bigint(20) NOT NULL,
  `warndlpercent` int(3) NOT NULL,
  `warnul` bigint(20) NOT NULL,
  `warnulpercent` int(3) NOT NULL,
  `warncomb` bigint(20) NOT NULL,
  `warncombpercent` int(3) NOT NULL,
  `warnuptime` bigint(20) NOT NULL,
  `warnuptimepercent` int(3) NOT NULL,
  `warnexpiry` int(11) NOT NULL,
  `expalertmode` tinyint(1) NOT NULL,
  `emailselfregman` tinyint(1) NOT NULL,
  `emailwelcome` tinyint(1) NOT NULL,
  `emailnewsrv` tinyint(1) NOT NULL,
  `emailrenew` tinyint(1) NOT NULL,
  `smsrenew` tinyint(1) NOT NULL,
  `emailexpiry` tinyint(1) NOT NULL,
  `smswelcome` tinyint(1) NOT NULL,
  `smsexpiry` tinyint(1) NOT NULL,
  `warnmode` tinyint(1) NOT NULL,
  `selfreg` tinyint(1) NOT NULL,
  `edituserdata` tinyint(1) NOT NULL,
  `hidelimits` tinyint(1) NOT NULL,
  `pm_internal` tinyint(1) NOT NULL,
  `pm_paypalstd` tinyint(1) NOT NULL,
  `pm_paypalpro` tinyint(1) NOT NULL,
  `pm_paypalexp` tinyint(1) NOT NULL,
  `pm_sagepay` tinyint(1) NOT NULL,
  `pm_authorizenet` tinyint(1) NOT NULL,
  `pm_dps` tinyint(1) NOT NULL,
  `pm_2co` tinyint(1) NOT NULL,
  `pm_payfast` tinyint(1) NOT NULL,
  `pm_citrus` tinyint(1) NOT NULL,
  `pm_paytm` tinyint(1) NOT NULL,
  `unixhost` tinyint(1) NOT NULL,
  `remotehostname` varchar(100) NOT NULL,
  `maclock` tinyint(1) NOT NULL,
  `billingstart` tinyint(2) NOT NULL,
  `disconnpostpaid` tinyint(1) NOT NULL,
  `renewday` tinyint(2) NOT NULL,
  `changepswucp` tinyint(1) NOT NULL,
  `redeemucp` tinyint(1) NOT NULL,
  `buycreditsucp` tinyint(1) NOT NULL,
  `selfreg_firstname` tinyint(1) NOT NULL,
  `selfreg_lastname` tinyint(1) NOT NULL,
  `selfreg_address` tinyint(1) NOT NULL,
  `selfreg_city` tinyint(1) NOT NULL,
  `selfreg_zip` tinyint(1) NOT NULL,
  `selfreg_country` tinyint(1) NOT NULL,
  `selfreg_state` tinyint(1) NOT NULL,
  `selfreg_phone` tinyint(1) NOT NULL,
  `selfreg_mobile` tinyint(1) NOT NULL,
  `selfreg_email` tinyint(1) NOT NULL,
  `selfreg_mobactsms` tinyint(1) NOT NULL,
  `selfreg_nameactemail` tinyint(1) NOT NULL,
  `selfreg_nameactsms` tinyint(1) NOT NULL,
  `selfreg_endupemail` tinyint(1) NOT NULL,
  `selfreg_endupmobile` tinyint(1) NOT NULL,
  `selfreg_vatid` tinyint(1) NOT NULL,
  `ias_email` tinyint(1) NOT NULL,
  `ias_mobile` tinyint(1) NOT NULL,
  `ias_verify` tinyint(1) NOT NULL,
  `ias_endupemail` tinyint(1) NOT NULL,
  `ias_endupmobile` tinyint(1) NOT NULL,
  `simuseselfreg` int(11) NOT NULL,
  `defgrpid` int(11) NOT NULL,
  `captcha` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_settings`
--

INSERT INTO `rm_settings` (`currency`, `unixacc`, `diskquota`, `quotatpl`, `paymentopt`, `changesrv`, `vatpercent`, `advtaxpercent`, `disablenotpaid`, `disableexpcont`, `resetctr`, `newnasallsrv`, `newmanallsrv`, `disconnmethod`, `warndl`, `warndlpercent`, `warnul`, `warnulpercent`, `warncomb`, `warncombpercent`, `warnuptime`, `warnuptimepercent`, `warnexpiry`, `expalertmode`, `emailselfregman`, `emailwelcome`, `emailnewsrv`, `emailrenew`, `smsrenew`, `emailexpiry`, `smswelcome`, `smsexpiry`, `warnmode`, `selfreg`, `edituserdata`, `hidelimits`, `pm_internal`, `pm_paypalstd`, `pm_paypalpro`, `pm_paypalexp`, `pm_sagepay`, `pm_authorizenet`, `pm_dps`, `pm_2co`, `pm_payfast`, `pm_citrus`, `pm_paytm`, `unixhost`, `remotehostname`, `maclock`, `billingstart`, `disconnpostpaid`, `renewday`, `changepswucp`, `redeemucp`, `buycreditsucp`, `selfreg_firstname`, `selfreg_lastname`, `selfreg_address`, `selfreg_city`, `selfreg_zip`, `selfreg_country`, `selfreg_state`, `selfreg_phone`, `selfreg_mobile`, `selfreg_email`, `selfreg_mobactsms`, `selfreg_nameactemail`, `selfreg_nameactsms`, `selfreg_endupemail`, `selfreg_endupmobile`, `selfreg_vatid`, `ias_email`, `ias_mobile`, `ias_verify`, `ias_endupemail`, `ias_endupmobile`, `simuseselfreg`, `defgrpid`, `captcha`) VALUES
('USD', 0, 0, 'template', 3, 2, '19.00', '0.00', 0, 0, 1, 1, 1, 0, 50, 0, 50, 0, 50, 0, 60, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, '127.0.0.1', 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 4, 1);

-- --------------------------------------------------------

--
-- Table structure for table `rm_specperacnt`
--

DROP TABLE IF EXISTS `rm_specperacnt`;
CREATE TABLE `rm_specperacnt` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `srvid` int(11) NOT NULL,
  `starttime` time NOT NULL,
  `endtime` time NOT NULL,
  `timeratio` decimal(3,2) NOT NULL,
  `dlratio` decimal(3,2) NOT NULL,
  `ulratio` decimal(3,2) NOT NULL,
  `connallowed` tinyint(1) NOT NULL,
  `mon` tinyint(1) NOT NULL,
  `tue` tinyint(1) NOT NULL,
  `wed` tinyint(1) NOT NULL,
  `thu` tinyint(1) NOT NULL,
  `fri` tinyint(1) NOT NULL,
  `sat` tinyint(1) NOT NULL,
  `sun` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `srvid` (`srvid`),
  KEY `fromtime` (`starttime`),
  KEY `totime` (`endtime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_specperacnt`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_specperbw`
--

DROP TABLE IF EXISTS `rm_specperbw`;
CREATE TABLE `rm_specperbw` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `srvid` int(11) NOT NULL,
  `starttime` time NOT NULL,
  `endtime` time NOT NULL,
  `dlrate` int(11) NOT NULL,
  `ulrate` int(11) NOT NULL,
  `dlburstlimit` int(11) NOT NULL,
  `ulburstlimit` int(11) NOT NULL,
  `dlburstthreshold` int(11) NOT NULL,
  `ulburstthreshold` int(11) NOT NULL,
  `dlbursttime` int(11) NOT NULL,
  `ulbursttime` int(11) NOT NULL,
  `enableburst` tinyint(1) NOT NULL,
  `priority` int(11) NOT NULL,
  `mon` tinyint(1) NOT NULL,
  `tue` tinyint(1) NOT NULL,
  `wed` tinyint(1) NOT NULL,
  `thu` tinyint(1) NOT NULL,
  `fri` tinyint(1) NOT NULL,
  `sat` tinyint(1) NOT NULL,
  `sun` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_specperbw`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_syslog`
--

DROP TABLE IF EXISTS `rm_syslog`;
CREATE TABLE `rm_syslog` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `datetime` datetime NOT NULL,
  `ip` varchar(15) NOT NULL,
  `name` varchar(64) NOT NULL,
  `eventid` int(11) NOT NULL,
  `data1` varchar(64) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_syslog`
--


-- --------------------------------------------------------

--
-- Table structure for table `rm_usergroups`
--

DROP TABLE IF EXISTS `rm_usergroups`;
CREATE TABLE `rm_usergroups` (
  `groupid` int(11) NOT NULL AUTO_INCREMENT,
  `groupname` varchar(50) NOT NULL,
  `descr` varchar(200) NOT NULL,
  PRIMARY KEY (`groupid`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_usergroups`
--

INSERT INTO `rm_usergroups` (`groupid`, `groupname`, `descr`) VALUES
(1, 'Default group', ''),
(2, 'Upstream 1', ''),
(3, 'NAS 1', ''),
(4, 'Self registration', ''),
(5, 'SMTP test', '');

-- --------------------------------------------------------

--
-- Table structure for table `rm_users`
--

DROP TABLE IF EXISTS `rm_users`;
CREATE TABLE `rm_users` (
  `username` varchar(64) NOT NULL,
  `password` varchar(32) NOT NULL,
  `groupid` int(11) NOT NULL,
  `enableuser` tinyint(1) NOT NULL,
  `uplimit` bigint(20) NOT NULL,
  `downlimit` bigint(20) NOT NULL,
  `comblimit` bigint(20) NOT NULL,
  `firstname` varchar(50) NOT NULL,
  `lastname` varchar(50) NOT NULL,
  `company` varchar(50) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `address` varchar(100) NOT NULL,
  `city` varchar(50) NOT NULL,
  `zip` varchar(8) NOT NULL,
  `country` varchar(50) NOT NULL,
  `state` varchar(50) NOT NULL,
  `comment` varchar(500) NOT NULL,
  `gpslat` decimal(17,14) NOT NULL,
  `gpslong` decimal(17,14) NOT NULL,
  `mac` varchar(17) NOT NULL,
  `usemacauth` tinyint(1) NOT NULL,
  `expiration` datetime NOT NULL,
  `uptimelimit` bigint(20) NOT NULL,
  `srvid` int(11) NOT NULL,
  `staticipcm` varchar(15) NOT NULL,
  `staticipcpe` varchar(15) NOT NULL,
  `ipmodecm` tinyint(1) NOT NULL,
  `ipmodecpe` tinyint(1) NOT NULL,
  `poolidcm` int(11) NOT NULL,
  `poolidcpe` int(11) NOT NULL,
  `createdon` date NOT NULL,
  `acctype` tinyint(1) NOT NULL,
  `credits` decimal(20,2) NOT NULL,
  `cardfails` tinyint(4) NOT NULL,
  `createdby` varchar(64) NOT NULL,
  `owner` varchar(64) NOT NULL,
  `taxid` varchar(40) NOT NULL,
  `cnic` varchar(13) NOT NULL,
  `email` varchar(100) NOT NULL,
  `maccm` varchar(17) NOT NULL,
  `custattr` varchar(10240) NOT NULL,
  `warningsent` tinyint(1) NOT NULL,
  `verifycode` varchar(10) NOT NULL,
  `verified` tinyint(1) NOT NULL,
  `selfreg` tinyint(1) NOT NULL,
  `verifyfails` tinyint(4) NOT NULL,
  `verifysentnum` tinyint(4) NOT NULL,
  `verifymobile` varchar(15) NOT NULL,
  `contractid` varchar(50) NOT NULL,
  `contractvalid` date NOT NULL,
  `actcode` varchar(60) NOT NULL,
  `pswactsmsnum` tinyint(4) NOT NULL,
  `alertemail` tinyint(1) NOT NULL,
  `alertsms` tinyint(1) NOT NULL,
  `lang` varchar(30) NOT NULL,
  `lastlogoff` datetime DEFAULT NULL,
  PRIMARY KEY (`username`),
  KEY `srvid` (`srvid`),
  KEY `groupid` (`groupid`),
  KEY `enableuser` (`enableuser`),
  KEY `firstname` (`firstname`),
  KEY `lastname` (`lastname`),
  KEY `company` (`company`),
  KEY `phone` (`phone`),
  KEY `mobile` (`mobile`),
  KEY `address` (`address`),
  KEY `city` (`city`),
  KEY `zip` (`zip`),
  KEY `country` (`country`),
  KEY `state` (`state`),
  KEY `comment` (`comment`(255)),
  KEY `mac` (`mac`),
  KEY `acctype` (`acctype`),
  KEY `email` (`email`),
  KEY `maccm` (`maccm`),
  KEY `owner` (`owner`),
  KEY `staticipcpe` (`staticipcpe`),
  KEY `staticipcm` (`staticipcm`),
  KEY `expiration` (`expiration`),
  KEY `createdon` (`createdon`),
  KEY `contractid` (`contractid`),
  KEY `contractvalid` (`contractvalid`),
  KEY `lastlogoff` (`lastlogoff`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_users`
--

INSERT INTO `rm_users` (`username`, `password`, `groupid`, `enableuser`, `uplimit`, `downlimit`, `comblimit`, `firstname`, `lastname`, `company`, `phone`, `mobile`, `address`, `city`, `zip`, `country`, `state`, `comment`, `gpslat`, `gpslong`, `mac`, `usemacauth`, `expiration`, `uptimelimit`, `srvid`, `staticipcm`, `staticipcpe`, `ipmodecm`, `ipmodecpe`, `poolidcm`, `poolidcpe`, `createdon`, `acctype`, `credits`, `cardfails`, `createdby`, `owner`, `taxid`, `cnic`, `email`, `maccm`, `custattr`, `warningsent`, `verifycode`, `verified`, `selfreg`, `verifyfails`, `verifysentnum`, `verifymobile`, `contractid`, `contractvalid`, `actcode`, `pswactsmsnum`, `alertemail`, `alertsms`, `lang`, `lastlogoff`) VALUES
('user', 'b59c67bf196a4758191e42f76670ceba', 1, 1, 4687156621, 2354054563, 7030725423, 'John', 'Smith', 'My Company', '455029545', '123', 'Oak road 1472.', 'Tampa', '1343', 'United States', 'Florida', '', '0.00000000000000', '0.00000000000000', '', 0, '2019-02-26 00:00:00', 3020399, 16, '', '', 0, 0, 0, 0, '2013-05-27', 0, '732.83', 1, 'admin', 'admin', 'AV43782', '122', 'user@user.com', '', '', 0, '', 0, 0, 0, 0, '', 'AE1323-12', '2015-02-01', 'DFDFCMXBJJXKKSFM1FTWXFSGG1S39R', 3, 1, 1, 'English', '2019-02-26 12:38:59');

-- --------------------------------------------------------

--
-- Table structure for table `rm_wlan`
--

DROP TABLE IF EXISTS `rm_wlan`;
CREATE TABLE `rm_wlan` (
  `maccpe` varchar(17) DEFAULT NULL,
  `signal` smallint(6) DEFAULT NULL,
  `ccq` smallint(6) DEFAULT NULL,
  `snr` smallint(6) DEFAULT NULL,
  `apip` varchar(15) DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `maccpe` (`maccpe`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;

--
-- Dumping data for table `rm_wlan`
--

